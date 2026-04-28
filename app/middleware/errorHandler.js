export const notFound = (req, res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  const isDev = process.env.NODE_ENV === "development";

  return res.status(statusCode).json({
    success: false,
    message: err.message || "Error interno del servidor",
    ...(isDev && { stack: err.stack }) 
  });
};