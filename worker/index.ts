import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { createApi } from '../server-api';

export default httpServerHandler(createServer(createApi()));
