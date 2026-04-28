export default (sequelize, Sequelize) => {
  return sequelize.define("refreshToken", {
    token: {
      type: Sequelize.STRING(512),
      allowNull: false
    },
    expiryDate: {
      type: Sequelize.DATE,
      allowNull: false
    }
  });
};