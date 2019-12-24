module.exports = {

  /* Определение функции, которая возвращает время в секундах, прошедшее с тех пор, 
    когда юзер обращался к навыку в последний раз */
  getDeltaTime: function (serverTime, dbTime) {
    if (dbTime === 0) return dbTime;
    return Math.ceil((serverTime - dbTime) / 1000);
  },

  /* Определение функции, которая возвращает в разговорной форме ("пару минут назад"), 
    время прошедшее с тех пор, когда юзер поручал навыку что-то запомнить в последний раз */
  getPeriod: function (seconds) {
    let amount, rounded, spell;
    amount = seconds / 3600;
    rounded = Math.round(amount);
    if (amount < 0.03) {
      spell = 'минуту назад';
    } else if (amount < 0.08) {
      spell = 'пару минут назад';
    } else if (amount < 0.3) {
      spell = 'несколько минут назад';
    } else if (amount <= 1) {
      spell = 'менее ч+аса назад';
    } else if (rounded % 10 === 1 || rounded === 1) {
      spell = `${rounded} час назад`;
    } else if (rounded % 10 > 4 || rounded % 10 === 0 || (rounded > 4 && rounded < 21) || rounded === 0) {
      spell = `${rounded} часов назад`;
    } else {
      spell = `${rounded} часа назад`;
    }
    return spell;
  }
};
