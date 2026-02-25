import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { AiPromptResponse } from '@ghostfolio/common/interfaces';
import { permissions } from '@ghostfolio/common/permissions';
import type { AiPromptMode, RequestWithUser } from '@ghostfolio/common/types';

import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Query,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AiService } from './ai.service';
import { AiSummaryResponse } from './interfaces/ai-summary.interface';

@Controller('ai')
export class AiController {
  public constructor(
    private readonly aiService: AiService,
    private readonly apiService: ApiService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get('prompt/:mode')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getPrompt(
    @Param('mode') mode: AiPromptMode,
    @Query('accounts') filterByAccounts?: string,
    @Query('assetClasses') filterByAssetClasses?: string,
    @Query('dataSource') filterByDataSource?: string,
    @Query('symbol') filterBySymbol?: string,
    @Query('tags') filterByTags?: string
  ): Promise<AiPromptResponse> {
    const filters = this.apiService.buildFiltersFromQueryParams({
      filterByAccounts,
      filterByAssetClasses,
      filterByDataSource,
      filterBySymbol,
      filterByTags
    });

    const prompt = await this.aiService.getPrompt({
      filters,
      mode,
      impersonationId: undefined,
      languageCode: this.request.user.settings.settings.language,
      userCurrency: this.request.user.settings.settings.baseCurrency,
      userId: this.request.user.id
    });

    return { prompt };
  }

  /**
   * GET /api/v1/ai/summary
   *
   * Returns a pre-computed AI-ready portfolio summary with:
   * - Holdings table in markdown
   * - Concentration risk metrics (HHI)
   * - Diversification score (0-100)
   * - Asset allocation breakdown
   * - Human-readable insight strings
   *
   * This endpoint is designed to be consumed by external AI agents
   * (like AgentForge) so they receive structured data instead of
   * having to compute risk metrics client-side.
   */
  @Get('summary')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getSummary(
    @Headers('impersonation-id') impersonationId: string,
    @Query('accounts') filterByAccounts?: string,
    @Query('assetClasses') filterByAssetClasses?: string,
    @Query('dataSource') filterByDataSource?: string,
    @Query('symbol') filterBySymbol?: string,
    @Query('tags') filterByTags?: string
  ): Promise<AiSummaryResponse> {
    const filters = this.apiService.buildFiltersFromQueryParams({
      filterByAccounts,
      filterByAssetClasses,
      filterByDataSource,
      filterBySymbol,
      filterByTags
    });

    return this.aiService.getSummary({
      filters,
      impersonationId,
      userCurrency: this.request.user.settings.settings.baseCurrency,
      userId: this.request.user.id
    });
  }
}
