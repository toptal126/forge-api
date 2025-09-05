import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Observable, catchError, map } from 'rxjs';
import {
  NewsSearchResponse,
  NewsSearchParams,
} from './interfaces/news.interface';

@Injectable()
export class NewsService {
  private readonly braveApiUrl =
    'https://api.search.brave.com/res/v1/news/search';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  searchNews(params: NewsSearchParams): Observable<NewsSearchResponse> {
    const token =
      params.token || this.configService.get<string>('BRAVE_API_TOKEN');

    if (!token) {
      throw new HttpException('API token is required', HttpStatus.BAD_REQUEST);
    }

    return this.httpService
      .get<NewsSearchResponse>(this.braveApiUrl, {
        params: { q: params.q, spellcheck_off: true },
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': token,
        },
      })
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          throw new HttpException(
            error.response?.data?.message || 'Failed to fetch news',
            error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }),
      );
  }
}
