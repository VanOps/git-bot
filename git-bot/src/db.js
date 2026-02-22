import mongoose from 'mongoose';

let _connected = false;

/**
 * Connect to MongoDB. Failures are non-fatal so the app still runs
 * without persistence when Mongo is unavailable (e.g. in unit tests).
 * @param {import('probot').Logger} log
 */
export async function connectDB(log) {
  const url =
    process.env.DATABASE_URL ?? 'mongodb://localhost:27017/probot_metrics';
  try {
    await mongoose.connect(url, { serverSelectionTimeoutMS: 5_000 });
    _connected = true;
    log.info(`[db] MongoDB connected → ${url}`);
  } catch (err) {
    log.warn(
      `[db] MongoDB unavailable (${err.message}) – metrics persistence disabled`,
    );
  }
}

/** Returns true only after a successful connect(). */
export const isConnected = () => _connected;

export default mongoose;
