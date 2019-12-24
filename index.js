const admin = require('firebase-admin');
const serviceAccount = require('./secret/serviceAccountKey.json');
const { lowerCase, sample, truncate, isEmpty } = require('lodash');
const { skillTitle, donateUrl, reviewUrl, tutorialUrl } = require('./src/settings');
const { imgDefault, imgRemember, imgForget } = require('./src/images');
const { getDeltaTime, getPeriod } = require('./src/utils');
const { CONTEXT, INTENT, getIntent } = require('./src/nlu');
const lex = require('./src/lexicon');

// Инициализируем Firestore:
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://remember-and-forget.firebaseio.com'
});

// Устанавливаем связь с БД, в которой будем хранить список юзеров (коллекция users):
const db = admin.firestore();
const usersRef = db.collection('users');

// Получаем текущее серверное время:
const server = admin.firestore;
const serverTime = server.Timestamp.fromDate(new Date()).toMillis();


// Тело Yndex Cloude Function:
module.exports.skill = async (event) => {
  try {
    // Получаем из события запрос Алисы необходимые данные:
    const { meta, request, session, version } = event;

    // Быстрый ответ на пингование Алисы:
    if (request.original_utterance === 'ping') {
      return {
        version,
        session,
        response: {
          text: 'ОК',
          end_session: true
        }
      };
    }

    // Голосовое и звуковое сообщение юзеру:
    let ttsMsg = '';

    // Закрыта ли сессия:
    let isEndSession = false;

    // Идентификатор девайса юзера:
    const userId = session.user_id;

    // Есть ли на девайсе юзера экран (если экран есть -- будем слать также картинки и кнопки):
    const hasScreen = typeof meta.interfaces.screen !== 'undefined' ? true : false;

    // Новая ли сессия:
    const isNewSession = session.new;

    // Получаем и переводим в нижний регистр сказанную юзером фразу:
    const userUtterance = lowerCase(request.original_utterance);

    // Карточка:
    let cardSlot = {};
    let cardImg = imgDefault;
    let cardTitle = skillTitle;
    let cardDesc = lex.cardDesc;

    // Кнопки:
    let buttonSlot = [];
    const donateBtn = { title: sample(lex.donateBtnText), url: donateUrl, hide: true };
    const reviewBtn = { title: sample(lex.reviewBtnText), url: reviewUrl, payload: 'review_tap', hide: true };
    const tutorialBtn = { title: sample(lex.tutorialBtnText), url: tutorialUrl, hide: true };

    // Иницилизируем переменные, значения которых будем хранить в БД:
    let memory = ''; // фраза юзера, которую надо запоминать
    let context = CONTEXT.empty; // контекст разговора, например для того, чтобы знать предыдущее состояние диалога, если юзер переспросит
    let isReview = false; // переходил ли юзер на стор навыков, чтобы поставить оценку
    let dbTime = 0; // штамп времени из БД когда юзер последний раз вызывал навык 
    let memTime = 0; // штамп времени из БД когда юзер записал свою фразу 

    // Обращаемся к БД за данными юзера:
    const userSnapshot = await usersRef.where(server.FieldPath.documentId(), '==', userId).get();
    let userData = {};

    // Получаем данные о юзере из БД:
    userSnapshot.forEach(doc => {
      userData = doc.data();
    });

    // Получаем состояния приложения из БД для не нового юзера:
    if (!isEmpty(userData)) {
      context = userData && userData.ctx;
      memory = userData && userData.mem;
      isReview = userData && userData.review;
      dbTime = userData && userData.timestamp1;
      memTime = userData && userData.timestamp2;
    }

    // Если нажималась кнопка reviewBtn -- значит был переход на сайт для оценки навыка:
    if (!isReview && request.payload === 'review_tap') {
      isReview = true;
    }

    // Как давно (в секундах) не было юзера:
    const deltaTime = getDeltaTime(serverTime, dbTime);

    // Разговорная фраза о времени как давно была сделана запись в память (типа: "пару минут назад"):
    const spokenTime = getPeriod(getDeltaTime(serverTime, memTime));

    // Определяем намерение (т.е. что он сказал) юзера:
    const intent = getIntent(userUtterance, context);


    // ДИАЛОГ С ЮЗЕРОМ:
    let msg = ''; // здесь будем временно хранить разные варианты части ответа, в зависимости от того, заполнена ли память или нет
    if (isNewSession) { // если юзер не новый, но новая сессия
      if (isEmpty(memory)) { // если память пуста
        msg = `${sample(lex.memoryEmpty)} ${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
        context = CONTEXT.empty;
      } else {  // память не пуста
        msg = `${sample(lex.memoryFull1)} ${spokenTime}. ${lex.memoryFull2} ${memory} ${lex.promptForget}`;
        context = CONTEXT.full;
        cardDesc = memory;
      }
      ttsMsg = `${sample(lex.hello)} ${msg}`;
    } else { // приветствия, инструкции и отчёты о состоянии памяти закончены, определяем что хочет юзер сейчас
      if (intent === INTENT.remember) { // юзер хочет чтобы его фраза была сохранена
        memory = truncate(userUtterance, { length: 256 }); // ограничим сохраняемую фразу до 256 символов
        ttsMsg = `${sample(lex.remember)} ${sample(lex.endSession)} ${sample(lex.byeFull)} ${skillTitle}.`;
        context = CONTEXT.full;
        cardImg = imgRemember;
        cardDesc = memory;
        memTime = serverTime;
        isEndSession = true;
      } else if (intent === INTENT.forget) { // юзер хочет чтобы фраза была забыта
        if (isEmpty(memory)) { // если забывать нечего
          ttsMsg = `${sample(lex.cantForget)} ${sample(lex.memoryEmpty)} ${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
        } else { // в противном случае
          memory = '';
          ttsMsg = `${sample(lex.forget)} ${sample(lex.endSession)} ${sample(lex.byeEmpty)} ${skillTitle}.`;
          context = CONTEXT.empty;
          cardImg = imgForget;
          memTime = 0;
          isEndSession = true;
        }
      } else if (intent === INTENT.help) { // юзер хочет получить помощь (справку)
        if (isEmpty(memory)) {
          msg = `${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
        } else {
          msg = '';
        }
        ttsMsg = `${lex.help} ${msg}`;
        context = CONTEXT.help;
        if (!isEmpty(memory)) cardDesc = memory;
      } else if (intent === INTENT.repeat) { // юзер просит повторить
        if (context === CONTEXT.help) {
          if (isEmpty(memory)) {
            msg = `${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
          } else {
            msg = '';
          }
          ttsMsg = `${lex.help} ${msg}`;
        } else {
          if (!isEmpty(memory)) {
            ttsMsg = `${sample(lex.memoryFull1)}. ${lex.memoryFull2} ${memory} ${lex.promptForget}`;
          } else {
            ttsMsg = `${sample(lex.memoryEmpty)} ${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
          }
        }
        if (!isEmpty(memory)) cardDesc = memory;
      } else if (intent === INTENT.exit) { // юзер хочет выйти
        ttsMsg = `${sample(lex.bye)} ${isEmpty(memory) ? sample(lex.byeEmpty) : sample(lex.byeFull)} ${skillTitle}.`;
        if (!isEmpty(memory)) cardDesc = memory;
        isEndSession = true;
      } else { // fallback, т.е. мы не поняли что хочет юзер, и пытаемся направить разговор в нужное русло
        if (isEmpty(memory)) {
          msg = `${sample(lex.promptRemember1)} ${sample(lex.promptRemember2)}`;
          context = CONTEXT.empty;
        } else {
          msg = `${sample(lex.memoryFull1)}. ${lex.memoryFull2} ${memory} ${lex.promptForget}`;
          context = CONTEXT.full;
          cardDesc = memory;
        }
        ttsMsg = `${sample(lex.fallback)} ${msg}`;
      }
    }


    // Если у юзера есть экран -- будем слать ему также картинки и кнопки:
    if (hasScreen) {
      // Формируем карточку с картинкой:
      cardSlot = {
        type: 'BigImage',
        image_id: cardImg,
        title: cardTitle.toUpperCase(),
        description: cardDesc,
        button: { // здесь кнопка -- это тап по карточки
          url: donateUrl,
        }
      };

      // Если сессия не закрыта -- кнопки в слот:
      if (!isEndSession) {
        buttonSlot.push(donateBtn); // кнопка на донат

        if (!isReview) { // кнопка 'Оценить навык' если юзер ранее не переходил на стор навыков для (возможной) оценки
          buttonSlot.push(reviewBtn);
        }

        buttonSlot.push(tutorialBtn); // кнопка на статью о том как сделать этот навык
      }
    }

    // Запись в БД нового состояния приложения сразу после ответа Алисе (т.е. после return), чтобы отвечать максимально быстро:
    setImmediate(async (userId, memory, context, isReview, serverTime, memTime) => {
      await usersRef.doc(userId).set({
        ctx: context,
        mem: memory,
        review: isReview,
        timestamp1: serverTime,
        timestamp2: memTime
      });
    }, userId, memory, context, isReview, serverTime, memTime);


    // Ответ Алисе:
    return {
      version,
      session,
      response: {
        text: ' ',
        tts: ttsMsg,
        card: cardSlot,
        buttons: buttonSlot,
        end_session: isEndSession
      }
    };

    // Обработка возможных ошибок:
  } catch (err) {
    console.error(err);
    return {
      'statusCode': 500,
      'headers': {
        'Content-Type': 'text/plain'
      },
      'isBase64Encoded': false,
      'body': `Internal server error: ${err}` // TODO скрыть переменную err в продакшн-версии.
    };
  }
};
