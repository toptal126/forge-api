import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('BundlerController Cache Prevention (e2e)', () => {
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

  it('should generate different responses for same keyword (no caching)', async () => {
    const keyword = 'bitcoin';

    // Make first request
    const response1 = await request(app.getHttpServer())
      .get(`/bundler/memecoin?keyword=${keyword}`)
      .expect(200);

    // Wait a bit to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Make second request with same keyword
    const response2 = await request(app.getHttpServer())
      .get(`/bundler/memecoin?keyword=${keyword}`)
      .expect(200);

    // Responses should be different (not cached)
    expect(response1.body.tokenSymbol).toBeDefined();
    expect(response2.body.tokenSymbol).toBeDefined();
    expect(response1.body.image).toBeDefined();
    expect(response2.body.image).toBeDefined();

    // At least one field should be different (indicating fresh generation)
    const isDifferent =
      response1.body.description !== response2.body.description ||
      response1.body.tokenSymbol !== response2.body.tokenSymbol ||
      response1.body.tokenName !== response2.body.tokenName ||
      response1.body.website !== response2.body.website ||
      response1.body.twitter !== response2.body.twitter ||
      response1.body.image !== response2.body.image;

    expect(isDifferent).toBe(true);
  }, 30000); // Longer timeout for AI generation

  it('should generate unique responses for different keywords', async () => {
    const keywords = ['bitcoin', 'ethereum', 'dogecoin'];
    const responses = [];

    for (const keyword of keywords) {
      const response = await request(app.getHttpServer())
        .get(`/bundler/memecoin?keyword=${keyword}`)
        .expect(200);

      responses.push(response.body);
    }

    // All responses should be different
    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        expect(responses[i].tokenSymbol).not.toBe(responses[j].tokenSymbol);
        expect(responses[i].tokenName).not.toBe(responses[j].tokenName);
      }
    }
  }, 45000); // Longer timeout for multiple AI generations
});
