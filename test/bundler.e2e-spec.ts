import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('BundlerController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/bundler/memecoin (GET) - should return memecoin metadata', () => {
    return request(app.getHttpServer())
      .get('/bundler/memecoin?keyword=bitcoin')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('description');
        expect(res.body).toHaveProperty('tokenSymbol');
        expect(res.body).toHaveProperty('tokenName');
        expect(res.body).toHaveProperty('website');
        expect(res.body).toHaveProperty('twitter');
        expect(res.body).toHaveProperty('image');
        expect(typeof res.body.image).toBe('string');
        expect(res.body.image).toMatch(/^https?:\/\/.+/);
      });
  });

  it('/bundler/memecoin (GET) - should return 400 for missing keyword', () => {
    return request(app.getHttpServer()).get('/bundler/memecoin').expect(400);
  });

  it('/bundler/memecoin (GET) - should return 400 for empty keyword', () => {
    return request(app.getHttpServer())
      .get('/bundler/memecoin?keyword=')
      .expect(400);
  });
});
