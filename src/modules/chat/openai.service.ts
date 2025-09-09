import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Readable } from 'stream';

// Centralized prompts to avoid duplication
const TOKEN_ANALYST_PROMPT = `You are an expert Web3 financial analyst specializing in blockchain token analysis. Provide detailed, data-driven insights using market metrics, on-chain analytics, and security assessments. Format responses in professional markdown with clear sections and bullet points for key metrics. Include risk disclaimers and maintain objectivity in analysis.

Important: Even if a token shows poor fundamentals or bad reputation, experienced traders may still consider meme trading opportunities. Always mention that skilled traders can profit from volatility regardless of token quality, but emphasize the high-risk nature of such strategies.`;

@Injectable()
export class OpenAIService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      baseURL: 'https://api.deepseek.com',
    });
  }

  async generateTokenAnalystChatCompletion(messages: any[]) {
    return await this.generateChatCompletion(messages, TOKEN_ANALYST_PROMPT);
  }

  async generateTokenAnalystChatCompletionStream(
    messages: any[],
  ): Promise<Readable> {
    return await this.generateChatCompletionStream(
      messages,
      TOKEN_ANALYST_PROMPT,
    );
  }

  async generateGeneralChatCompletion(messages: any[]) {
    return await this.generateChatCompletion(
      messages,
      'You are a helpful assistant that can answer questions and help with tasks related to web3, crypto, and blockchain, Keep answers brief and to the point.',
    );
  }

  async generateChatCompletion(messages: any[], systemPrompt: string) {
    try {
      const fullMessages = [
        {
          role: 'system',
          content: systemPrompt, // Your critical market data & instructions
        },
        ...messages, // The rest of the conversation (user & assistant messages)
      ];

      const options: any = {
        // model: 'gpt-4o-search-preview',
        model: 'deepseek-chat',
        messages: fullMessages,
        temperature: 1,
      };

      const response = await this.openai.chat.completions.create(options);
      return response.choices[0].message;
    } catch (error) {
      console.error('Error generating chat completion:', error);
      throw error;
    }
  }

  async generateChatCompletionStream(
    messages: any[],
    systemPrompt: string,
  ): Promise<Readable> {
    try {
      const fullMessages = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...messages,
      ];

      const options: any = {
        model: 'deepseek-chat',
        messages: fullMessages,
        temperature: 1,
        stream: true,
      };

      const stream = await this.openai.chat.completions.create(options);

      // Convert the OpenAI stream to a Node.js Readable stream
      const readableStream = new Readable({
        objectMode: true,
        read() {},
      });

      // Process the stream chunks using async iteration
      (async () => {
        try {
          for await (const chunk of stream as any) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              readableStream.push({
                type: 'content',
                content: content,
                timestamp: new Date().toISOString(),
              });
            }
          }

          readableStream.push({
            type: 'done',
            timestamp: new Date().toISOString(),
          });
          readableStream.push(null); // End the stream
        } catch (error) {
          console.error('Error processing stream:', error);
          readableStream.push({
            type: 'error',
            error: error.message,
            timestamp: new Date().toISOString(),
          });
          readableStream.push(null);
        }
      })();

      return readableStream;
    } catch (error) {
      console.error('Error generating chat completion stream:', error);
      throw error;
    }
  }
}
