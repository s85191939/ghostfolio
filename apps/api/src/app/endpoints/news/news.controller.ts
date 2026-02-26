import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { REQUEST } from '@nestjs/core';

import { NewsService } from './news.service';
import type { CreateAlertDto, UpdateAlertDto } from './interfaces/news.interface';

@Controller('news')
@UseGuards(AuthGuard('jwt'))
export class NewsController {
  public constructor(
    private readonly newsService: NewsService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  // GET /api/v1/news?symbol=AAPL
  @Get()
  public async getNews(@Query('symbol') symbol?: string) {
    if (symbol) {
      return this.newsService.getNewsForSymbol(symbol);
    }

    return this.newsService.getNewsForPortfolio(this.request.user.id);
  }

  // GET /api/v1/news/portfolio
  @Get('portfolio')
  public async getPortfolioNews() {
    return this.newsService.getNewsForPortfolio(this.request.user.id);
  }

  // POST /api/v1/news/alerts
  @Post('alerts')
  public async createAlert(@Body() dto: CreateAlertDto) {
    if (!dto.symbol) {
      throw new HttpException(
        'symbol is required',
        HttpStatus.BAD_REQUEST
      );
    }

    return this.newsService.createAlert(
      this.request.user.id,
      dto.symbol,
      dto.keywords
    );
  }

  // GET /api/v1/news/alerts
  @Get('alerts')
  public async listAlerts() {
    return this.newsService.listAlerts(this.request.user.id);
  }

  // PATCH /api/v1/news/alerts/:id
  @Patch('alerts/:id')
  public async updateAlert(
    @Param('id') id: string,
    @Body() dto: UpdateAlertDto
  ) {
    const result = await this.newsService.updateAlert(
      id,
      this.request.user.id,
      dto
    );

    if (!result) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  // DELETE /api/v1/news/alerts/:id
  @Delete('alerts/:id')
  public async deleteAlert(@Param('id') id: string) {
    const deleted = await this.newsService.deleteAlert(
      id,
      this.request.user.id
    );

    if (!deleted) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }

    return { deleted: true };
  }
}
