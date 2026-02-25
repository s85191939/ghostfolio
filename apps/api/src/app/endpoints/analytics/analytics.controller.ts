import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Controller,
  Get,
  Headers,
  Inject,
  Query,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AnalyticsService } from './analytics.service';
import { PortfolioAnalyticsResponse } from './interfaces/portfolio-analytics.interface';

@Controller('analytics')
export class AnalyticsController {
  public constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly apiService: ApiService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  /**
   * GET /api/v1/analytics
   *
   * Returns computed portfolio analytics including concentration risk,
   * diversification score, asset allocation breakdown, and AI-ready
   * insight strings.
   */
  @Get()
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getAnalytics(
    @Headers('impersonation-id') impersonationId: string,
    @Query('accounts') filterByAccounts?: string,
    @Query('assetClasses') filterByAssetClasses?: string,
    @Query('dataSource') filterByDataSource?: string,
    @Query('symbol') filterBySymbol?: string,
    @Query('tags') filterByTags?: string
  ): Promise<PortfolioAnalyticsResponse> {
    const filters = this.apiService.buildFiltersFromQueryParams({
      filterByAccounts,
      filterByAssetClasses,
      filterByDataSource,
      filterBySymbol,
      filterByTags
    });

    return this.analyticsService.getAnalytics({
      filters,
      impersonationId,
      userId: this.request.user.id
    });
  }
}
