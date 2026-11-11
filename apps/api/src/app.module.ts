import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { isLanWebOrigin } from '@orbit/shared';
import { AiModule } from './ai/ai.module';
import { AuthController } from './auth/auth.controller';
import { PhoneAccess } from './auth/phone-access';
import { CoreModule } from './core/core.module';
import { CommentsController, IdeaCommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { AuthGuard, Public } from './core/guards';
import { CONFIG, type Config } from './core/tokens';
import { IdeasController } from './ideas/ideas.controller';
import { IdeasService } from './ideas/ideas.service';
import { ItineraryController } from './itinerary/itinerary.controller';
import { ItineraryService } from './itinerary/itinerary.service';
import { PhotoFilesController, PlanPhotosController } from './photos/photos.controller';
import { PhotosService } from './photos/photos.service';
import { LocalPhotoStorage, PHOTO_STORAGE } from './photos/storage';
import { PlanController, PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';
import { InvitesService } from './sharing/invites.service';
import { MembersService } from './sharing/members.service';
import { InvitesController, PlanInvitesController, PlanMembersController } from './sharing/sharing.controller';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({ controllers: [AuthController], providers: [PhoneAccess] })
class AuthModule {}

@Module({ controllers: [PlansController, PlanController], providers: [PlansService] })
class PlansModule {}

@Module({ controllers: [IdeasController], providers: [IdeasService] })
class IdeasModule {}

@Module({ controllers: [ItineraryController], providers: [ItineraryService] })
class ItineraryModule {}

@Module({
  controllers: [PlanInvitesController, PlanMembersController, InvitesController],
  providers: [InvitesService, MembersService],
})
class SharingModule {}

@Module({ controllers: [IdeaCommentsController, CommentsController], providers: [CommentsService] })
class CommentsModule {}

@Module({
  controllers: [PlanPhotosController, PhotoFilesController],
  providers: [
    PhotosService,
    { provide: PHOTO_STORAGE, useFactory: (config: Config) => new LocalPhotoStorage(config.uploadsDir), inject: [CONFIG] },
  ],
})
class PhotosModule {}

/**
 * Modular monolith: feature modules share one process and one database, with
 * boundaries drawn by module. Realtime (Hocuspocus) runs as a separate process.
 */
@Module({
  imports: [CoreModule, AuthModule, PlansModule, IdeasModule, ItineraryModule, SharingModule, CommentsModule, PhotosModule, AiModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}

export function configureApp(app: INestApplication, config: Config): void {
  app.setGlobalPrefix('v1');
  const allowed = new Set(config.webOrigins);
  app.enableCors({
    // Phone mode also lets in the web app as a phone on this Wi-Fi sees it
    // (http://<private address>:<web port>), whatever the address is today.
    origin: (origin: string | undefined, done: (error: Error | null, allow?: boolean) => void) =>
      done(null, !!origin && (allowed.has(origin) || (config.lanMode && isLanWebOrigin(origin, config.webPort)))),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  app.enableShutdownHooks();
}
