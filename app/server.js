import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet"; 
import db from "./models/index.js";

dotenv.config();

const app = express();
app.use(helmet()); 

app.use(cors());
app.use(express.json());

// Detectar entorno
const isDev = process.env.NODE_ENV === "development";

// Sincronización inteligente
await db.sequelize.sync({
  force: isDev // solo borra BD en desarrollo
});

// Inicializar roles (solo si no existen)
const count = await db.role.count();

if (count === 0) {
  await db.role.bulkCreate([
    { id: 1, name: "user" },
    { id: 2, name: "moderator" },
    { id: 3, name: "admin" }
  ]);
  console.log("Roles creados");
}

// rutas
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";

authRoutes(app);
userRoutes(app);
import { notFound, errorHandler } from "./middleware/errorHandler.js";
app.use(notFound);
app.use(errorHandler);
// Puerto desde .env
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV}`);
});


