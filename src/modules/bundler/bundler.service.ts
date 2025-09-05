import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { NewsService } from '../news/news.service';
import {
  MemecoinMetadata,
  MemecoinGenerationParams,
} from './interfaces/memecoin.interface';

@Injectable()
export class BundlerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly newsService: NewsService,
  ) {}

  private createFreshOpenAIInstance(): OpenAI {
    return new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      baseURL: 'https://api.deepseek.com',
    });
  }

  async generateMemecoinMetadata(keyword: string): Promise<MemecoinMetadata> {
    try {
      // Search for news related to the keyword
      const newsResponse = await this.newsService
        .searchNews({
          q: `what is andy why is #${keyword} viral in twitter, find twitter urls`,
        })
        .toPromise();

      if (
        !newsResponse ||
        !newsResponse.results ||
        newsResponse.results.length === 0
      ) {
        throw new HttpException(
          'No news found for the given keyword',
          HttpStatus.NOT_FOUND,
        );
      }
      console.log(newsResponse);
      // Extract news content for the prompt
      const newsContent = this.extractNewsContent(newsResponse.results);
      // console.log(newsContent);
      // Generate memecoin metadata using OpenAI
      const memecoinMetadata = await this.generateMemecoinWithOpenAI(
        keyword,
        newsContent,
      );

      return memecoinMetadata;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to generate memecoin metadata',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private extractNewsContent(newsResults: any[]): string {
    return newsResults
      .slice(0, 5) // Limit to first 5 news articles
      .map(
        (article) =>
          `${article.title}: ${article.description} url: ${article.url}`,
      )
      .join('\n\n');
  }

  private async generateMemecoinWithOpenAI(
    keyword: string,
    news: string,
  ): Promise<MemecoinMetadata> {
    // Generate unique conversation ID to prevent caching
    const conversationId = `memecoin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const prompt = `create a meme coin of ${keyword}
Need just description, token symbol, token name, website, twitter, and image.
must be in json format, no markdown at all, nor in beggining or ending.

 Create a compelling, viral-worthy memecoin concept
 Make it relevant to current trends and news
 Ensure the token symbol is catchy and memorable (3-5 characters)
 Create a creative token name that relates to the keyword and news
 Write an engaging description that explains the meme concept
 Extract website and Twitter, image src from the news context

${news}`;

    try {
      const openai = this.createFreshOpenAIInstance();
      const response = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are an expert in creating memecoin metadata. Always respond with valid JSON format containing description, tokenSymbol, tokenName, website, twitter, and image fields. 
            
            IMPORTANT: This is a fresh conversation (ID: ${conversationId}). Do not reference any previous conversations or cached responses. Create unique, original content based only on the current request.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.9, // Higher temperature for more creativity and less repetition
        max_tokens: 1000,
        top_p: 0.95, // Nucleus sampling for more diverse responses
        frequency_penalty: 0.5, // Reduce repetition
        presence_penalty: 0.5, // Encourage new topics
        user: conversationId, // Unique user ID to prevent caching
      });

      const content = response.choices[0].message.content;

      if (!content) {
        throw new Error('No content received from OpenAI');
      }

      console.log(`Generated for conversation ${conversationId}:`, content);

      // Clean the content to ensure it's valid JSON
      const cleanedContent = this.cleanJsonResponse(content);

      // Parse the JSON response
      const memecoinData = JSON.parse(cleanedContent);

      // Generate image using DALL-E with unique prompt
      const imageUrl = await this.generateTokenImage(
        `${keyword} memecoin logo ${conversationId}`,
        memecoinData.image || keyword,
      );

      // Add the generated image URL to the metadata
      memecoinData.image = imageUrl;

      // Validate the response structure
      if (!this.isValidMemecoinMetadata(memecoinData)) {
        throw new Error('Invalid memecoin metadata structure');
      }

      return memecoinData;
    } catch (error) {
      console.error('Error generating memecoin metadata:', error);
      throw new HttpException(
        'Failed to generate memecoin metadata with AI',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private cleanJsonResponse(content: string): string {
    // Remove any markdown formatting
    let cleaned = content.trim();

    // Remove markdown code blocks
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    // Remove any text before the first {
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) {
      cleaned = cleaned.substring(firstBrace);
    }

    // Remove any text after the last }
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }

    return cleaned;
  }

  private async generateTokenImage(
    uniquePrompt: string,
    imagePrompt: string,
  ): Promise<string> {
    try {
      const openai = this.createFreshOpenAIInstance();
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: `Create a unique, professional memecoin logo: ${imagePrompt}. 
        
        Design requirements:
        - Colorful, eye-catching, and memorable
        - Suitable for cryptocurrency/blockchain context
        - Fun, playful, and community-oriented
        - Clean, modern design that works at any size
        - Include elements that represent the meme concept
        - Professional quality suitable for social media and marketing
        - Avoid text in the logo, focus on visual elements
        - Use vibrant colors and bold shapes
        - Make it instantly recognizable and shareable
        - Unique design for: ${uniquePrompt}`,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
        user: uniquePrompt, // Unique user ID to prevent caching
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL returned from DALL-E');
      }

      return imageUrl;
    } catch (error) {
      console.error('Error generating token image:', error);
      // Return a placeholder image URL if generation fails
      return `https://via.placeholder.com/1024x1024/4F46E5/FFFFFF?text=${encodeURIComponent(uniquePrompt)}`;
    }
  }

  private isValidMemecoinMetadata(data: any): data is MemecoinMetadata {
    return (
      data &&
      typeof data.description === 'string' &&
      typeof data.tokenSymbol === 'string' &&
      typeof data.tokenName === 'string' &&
      typeof data.website === 'string' &&
      typeof data.twitter === 'string' &&
      typeof data.image === 'string'
    );
  }
}
