import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

/** What each user chooses for their own view, such as the columns of the list of cases. */
@Module({ controllers: [PreferencesController], providers: [PreferencesService] })
export class PreferencesModule {}
