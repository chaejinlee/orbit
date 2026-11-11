import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { PhoneAccess } from './auth/phone-access';
import { CONFIG, type Config } from './core/tokens';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
const config = app.get<Config>(CONFIG);
configureApp(app, config);
await app.listen(config.apiPort, config.bindHost);
console.log(`Orbit API ready on http://${config.bindHost}:${config.apiPort}/v1`);
console.log(
  config.ai.provider
    ? `Orbit AI: ${config.ai.provider} (${config.ai.model}), ${config.ai.dailyLimitPerUser} calls per person per day`
    : 'Orbit AI: off. Add GEMINI_API_KEY to .env to turn it on (or AI_PROVIDER=fake for canned answers).',
);

const phone = app.get(PhoneAccess);
if (phone.enabled) {
  const [url] = phone.urls();
  console.log(
    url
      ? `Phone mode: on a phone on the same Wi-Fi, open ${url} and sign in with code ${phone.current()} (also under “On your phone” in Orbit on this computer).`
      : 'Phone mode is on, but this computer has no Wi-Fi or LAN address right now.',
  );
}
