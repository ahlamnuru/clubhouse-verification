const { DataTypes, Model } = require("sequelize");
const sequelize = require("./index");

class Message extends Model {}

Message.init(
  {
    title: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: { notEmpty: true },
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { notEmpty: true },
    },
  },
  {
    sequelize,
    modelName: "Message",
  },
);

module.exports = Message;
