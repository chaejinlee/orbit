import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import {
  commitItineraryInput,
  type CommitItineraryInput,
  type ItineraryStateDTO,
  type ItineraryVersionDTO,
} from '@orbit/shared';
import { PlanAccessGuard, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import type { AuthUser } from '../core/tokens';
import { ItineraryService } from './itinerary.service';

@Controller('plans/:planId/itinerary')
@UseGuards(PlanAccessGuard)
export class ItineraryController {
  constructor(@Inject(ItineraryService) private readonly itinerary: ItineraryService) {}

  @Get()
  @RequirePermission('plan.view')
  state(@Param('planId') planId: string): Promise<ItineraryStateDTO> {
    return this.itinerary.state(planId);
  }

  @Get('versions/:version')
  @RequirePermission('plan.view')
  version(
    @Param('planId') planId: string,
    @Param('version', new ParseIntPipe()) version: number,
  ): Promise<ItineraryVersionDTO> {
    return this.itinerary.version(planId, version);
  }

  @Post('commits')
  @RequirePermission('itinerary.commit')
  commit(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(commitItineraryInput)) body: CommitItineraryInput,
  ): Promise<ItineraryVersionDTO> {
    return this.itinerary.commit(planId, user, body);
  }
}
