
import db from "../models/index.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const User = db.user;
const Role = db.role;

/**
 * Utilidad: respuestas de error consistentes
 */
const errorResponse = (res, status, message, details = null) => {
  return res.status(status).json({
    success: false,
    message,
    ...(details && { details })
  });
};

/**
 * Utilidad: validación básica de email
 */
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * 🔹 SIGNUP (Registro)
 * - Valida campos
 * - Verifica que existan roles en BD
 * - Valida roles enviados (si vienen)
 * - Asigna roles (o default "user")
 * - Hashea password
 */
export const signup = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { username, email, password, roles } = req.body || {};

    // Validaciones de entrada
    if (!username || !email || !password) {
      await t.rollback();
      return errorResponse(res, 400, "Faltan campos requeridos: username, email, password");
    }

    if (username.length < 3) {
      await t.rollback();
      return errorResponse(res, 400, "El username debe tener al menos 3 caracteres");
    }

    if (!isValidEmail(email)) {
      await t.rollback();
      return errorResponse(res, 400, "Email inválido");
    }

    if (password.length < 6) {
      await t.rollback();
      return errorResponse(res, 400, "El password debe tener al menos 6 caracteres");
    }

    // Verificar duplicados (defensa adicional a middleware)
    const exists = await User.findOne({
      where: {
        [db.Sequelize.Op.or]: [{ username }, { email }]
      },
      transaction: t
    });

    if (exists) {
      await t.rollback();
      return errorResponse(res, 400, "Username o email ya están en uso");
    }

    // Verificar que existan roles en BD
    const rolesCount = await Role.count({ transaction: t });
    if (rolesCount === 0) {
      await t.rollback();
      return errorResponse(
        res,
        500,
        "No existen roles en la base de datos. Inicializa roles antes de registrar usuarios."
      );
    }

    // Crear usuario
    const user = await User.create(
      {
        username,
        email,
        password: bcrypt.hashSync(password, 10)
      },
      { transaction: t }
    );

    // Resolver roles a asignar
    let rolesToAssign = [];

    if (Array.isArray(roles) && roles.length > 0) {
      // Validar que los roles existan
      const foundRoles = await Role.findAll({
        where: { name: roles },
        transaction: t
      });

      if (foundRoles.length !== roles.length) {
        await t.rollback();
        return errorResponse(res, 400, "Uno o más roles no existen");
      }

      rolesToAssign = foundRoles;
    } else {
      // Rol por defecto
      const defaultRole = await Role.findOne({
        where: { name: "user" },
        transaction: t
      });

      if (!defaultRole) {
        await t.rollback();
        return errorResponse(res, 500, "No existe el rol por defecto 'user'");
      }

      rolesToAssign = [defaultRole];
    }

    // Asignar roles (tabla intermedia user_roles)
    await user.setRoles(rolesToAssign, { transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Usuario registrado correctamente",
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: rolesToAssign.map(r => r.name)
      }
    });

  } catch (error) {
    await t.rollback();

    // Manejo de errores de Sequelize (por si tienes constraints únicos)
    if (error.name === "SequelizeUniqueConstraintError") {
      return errorResponse(res, 400, "Username o email ya están en uso");
    }

    return errorResponse(res, 500, "Error al registrar usuario", error.message);
  }
};

/**
 * 🔹 SIGNIN (Login)
 * - Valida entrada
 * - Verifica credenciales
 * - Incluye roles en respuesta
 * - Genera JWT
 */
export const signin = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return errorResponse(res, 400, "Email y password son requeridos");
    }

    // Buscar usuario + roles
    const user = await User.findOne({
      where: { email },
      include: {
        model: Role,
        through: { attributes: [] }
      }
    });

    if (!user) {
      return errorResponse(res, 404, "Usuario no encontrado");
    }

    // Validar password
    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return errorResponse(res, 401, "Password incorrecto");
    }

    // Generar Access Token (corta duración)
    const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: "2m" } 
    );

    // Generar Refresh Token
    const refreshTokenValue = jwt.sign(
        { id: user.id },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" }
    );

    // Guardar refresh token en BD
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);

    await db.refreshToken.create({
        token: refreshTokenValue,
        expiryDate,
        userId: user.id
    });

    // Preparar roles para respuesta
    const authorities = user.roles?.map(r => r.name) || [];

    return res.status(200).json({
      success: true,
      message: "Login exitoso",
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: authorities,
        accessToken: token,
        refreshToken: refreshTokenValue 

      }
    });

  } catch (error) {
    return errorResponse(res, 500, "Error en login", error.message);
  }
};

export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return errorResponse(res, 403, "Refresh token requerido");
    }

    // Buscar en BD
    const storedToken = await db.refreshToken.findOne({
      where: { token }
    });

    if (!storedToken) {
      return errorResponse(res, 403, "Refresh token inválido o ya fue usado");
    }

    // Verificar expiración
    if (new Date() > storedToken.expiryDate) {
      await storedToken.destroy();
      return errorResponse(res, 403, "Refresh token expirado, inicia sesión nuevamente");
    }

    // Verificar firma
    jwt.verify(token, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return errorResponse(res, 401, "Refresh token inválido");
      }

      // Generar nuevo Access Token
      const newAccessToken = jwt.sign(
        { id: decoded.id },
        process.env.JWT_SECRET,
        { expiresIn: "2m" }
      );

      return res.status(200).json({
        success: true,
        accessToken: newAccessToken
      });
    });

  } catch (error) {
    return errorResponse(res, 500, "Error al renovar token", error.message);
  }
};

export const logout = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return errorResponse(res, 400, "Refresh token requerido");
    }

    // Buscar y eliminar el refresh token
    const deleted = await db.refreshToken.destroy({
      where: { token }
    });

    if (deleted === 0) {
      return errorResponse(res, 404, "Refresh token no encontrado");
    }

    return res.status(200).json({
      success: true,
      message: "Sesión cerrada correctamente"
    });

  } catch (error) {
    return errorResponse(res, 500, "Error al cerrar sesión", error.message);
  }
};