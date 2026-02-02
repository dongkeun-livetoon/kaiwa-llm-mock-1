import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { chatRoute } from './routes/chat';
import { imageRoute } from './routes/image';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', cors({
  origin: (origin, c) => {
    // Allow all origins in development
    if (!origin) return '*';
    // In production, check CORS_ORIGIN
    if (c.env.CORS_ORIGIN) {
      return origin === c.env.CORS_ORIGIN ? origin : undefined;
    }
    return '*';
  },
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

// Mount routes
app.route('/', chatRoute);
app.route('/', imageRoute);

export default app;
