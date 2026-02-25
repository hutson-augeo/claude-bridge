import { z } from 'zod';
import { configSchema } from '../config.js';

export type Config = z.infer<typeof configSchema>;
