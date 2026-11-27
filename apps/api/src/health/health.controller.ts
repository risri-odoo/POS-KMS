import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { HealthService, type Readiness } from './health.service.js';

/** Open without a token: probes have none, and the answers reveal nothing sensitive. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness: the process is running (checks nothing else)' })
  @ApiResponse({ status: 200, description: '{ status: "ok" }' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database answers, and Redis when the HAIP bridge uses it' })
  @ApiResponse({ status: 200, description: 'Ready: { status: "ok", checks: { database, redis } }' })
  @ApiResponse({ status: 503, description: 'Not ready; checks says which part is down (no details)' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
