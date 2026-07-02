import { Injectable } from '@angular/core';

import {
  FOREPATH_LLM_MEMORY_PROFILE_BALANCED,
  type ForepathLlmMemoryProfile,
} from '../constants/forepath-llm-memory.constants';
import { assertBrowserMemoryHeadroom } from '../utils/forepath-browser-memory.utils';

@Injectable()
export class ForepathLlmMemoryProfileService {
  private profile: ForepathLlmMemoryProfile = FOREPATH_LLM_MEMORY_PROFILE_BALANCED;

  setProfile(profile: ForepathLlmMemoryProfile): void {
    this.profile = profile;
  }

  getProfile(): ForepathLlmMemoryProfile {
    return this.profile;
  }

  assertMemoryHeadroom(): void {
    assertBrowserMemoryHeadroom();
  }
}
