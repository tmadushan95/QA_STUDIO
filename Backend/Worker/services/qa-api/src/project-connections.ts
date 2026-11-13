import {
  ConfigError,
  parseProjectConnection,
  parseSettings,
  type AppSettings,
  type LoginStrategy,
  type ProjectConnection,
} from '@qa-studio/shared';
import type { RunTarget } from './app.js';
import { HttpError } from './errors.js';

/** A project's connection as the screens see it. */
export interface ProjectConnectionView extends ProjectConnection {
  projectId: number;
  /** False when it no longer passes the rules, for example its environment was taken off the allow-list. */
  ready: boolean;
  reason?: string;
}

export interface ProjectConnectionDeps {
  store: { loadConfig(key: string): unknown; saveConfig(key: string, value: unknown): void };
  /** The install-wide values: execution options for every run, and the old single address to start from. */
  settings: { values(): AppSettings };
  /** Read from the environment only, so it cannot be widened from the browser. */
  allowedEnvs: string[];
  /** Record a configuration change. */
  audit(action: string, target: string, detail: string): void;
}

const CONFIG_KEY = 'project-connections';
const NOT_SET_UP = 'has no application address yet. Set it up in its Project settings.';

/**
 * Each project's application address, environment and sign-in method. Projects live in the database behind the .NET
 * API, but only this worker runs tests and knows the rules for a safe address, so it owns these and keeps them as a
 * configuration block. Browser, speed and timeouts stay install-wide: they describe this machine, not the application.
 */
export class ProjectConnectionService {
  private saved: Record<string, ProjectConnection>;
  private readonly hadSaved: boolean;

  constructor(private readonly d: ProjectConnectionDeps) {
    const stored = d.store.loadConfig(CONFIG_KEY);
    this.hadSaved = typeof stored === 'object' && stored !== null;
    this.saved = this.hadSaved ? (stored as Record<string, ProjectConnection>) : {};
  }

  /**
   * First start after projects got their own connections: the projects that hold test cases keep the address and
   * sign-in they have been running with, so nothing has to be entered again. Happens once.
   */
  seedFromSettings(projectIds: number[]): void {
    if (this.hadSaved) return;
    const { envName, appUrl, login } = this.d.settings.values();
    let seed: ProjectConnection | undefined;
    try {
      seed = parseProjectConnection({ envName, appUrl, login }, this.d.allowedEnvs);
    } catch (e) {
      // Nothing usable was set up before, so these projects simply start out needing setup.
      if (!(e instanceof ConfigError)) throw e;
    }
    const next: Record<string, ProjectConnection> = {};
    if (seed) for (const id of new Set(projectIds)) next[String(id)] = seed;
    this.saved = next;
    this.d.store.saveConfig(CONFIG_KEY, next);
  }

  private view(projectId: number, c: ProjectConnection): ProjectConnectionView {
    try {
      parseProjectConnection(c, this.d.allowedEnvs);
      return { projectId, ...c, ready: true };
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return { projectId, ...c, ready: false, reason: e.message };
    }
  }

  list(): { items: ProjectConnectionView[]; allowedEnvs: string[] } {
    return {
      items: Object.entries(this.saved).map(([id, c]) => this.view(Number(id), c)),
      allowedEnvs: this.d.allowedEnvs,
    };
  }

  private parse(input: unknown): ProjectConnection {
    try {
      return parseProjectConnection(input, this.d.allowedEnvs);
    } catch (e) {
      if (e instanceof ConfigError) {
        const fields = Object.fromEntries(e.issues.map((i) => [i.path, i.message]));
        throw new HttpError(400, 'invalid-connection', e.message, fields);
      }
      throw e;
    }
  }

  /** Validate without saving, so a new project is not created with an address that will then be refused. */
  check(input: unknown): void {
    this.parse(input);
  }

  save(projectId: number, input: unknown): ProjectConnectionView {
    const next = this.parse(input);
    const before = this.saved[String(projectId)];
    this.saved = { ...this.saved, [String(projectId)]: next };
    this.d.store.saveConfig(CONFIG_KEY, this.saved);
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      this.d.audit('project.connection', `Project ${projectId}`, `Application: ${next.appUrl}.`);
    }
    return this.view(projectId, next);
  }

  /** The settings a run of this project uses, validated. Throws a ConfigError saying what to fix. */
  settingsFor(projectId: number | undefined): AppSettings {
    const c = projectId === undefined ? undefined : this.saved[String(projectId)];
    if (!c) throw new ConfigError(`This project ${NOT_SET_UP}`);
    return parseSettings({ ...this.d.settings.values(), ...c }, this.d.allowedEnvs);
  }

  /** The project's sign-in method, when it has a connection. */
  signInMethod(projectId: number): LoginStrategy | undefined {
    return this.saved[String(projectId)]?.login.strategy;
  }

  target(projectId: number | undefined, projectName?: string): RunTarget {
    const named = {
      ...(projectId !== undefined && { projectId }),
      ...(projectName !== undefined && { projectName }),
    };
    const c = projectId === undefined ? undefined : this.saved[String(projectId)];
    if (projectId === undefined || !c) {
      return {
        ...named,
        environment: '',
        loginRequired: false,
        available: false,
        reason: `${projectName ?? 'This project'} ${NOT_SET_UP}`,
      };
    }
    const { ready, reason } = this.view(projectId, c);
    return {
      ...named,
      environment: c.envName,
      appUrl: c.appUrl,
      loginRequired: c.login.strategy !== 'none',
      available: ready,
      ...(reason !== undefined && { reason }),
    };
  }

  /** The first project that can run, for work not tied to one project. */
  firstReady(): number | undefined {
    return this.list().items.find((c) => c.ready)?.projectId;
  }

  /** Runs can start if at least one project is set up; each start then checks the projects it actually uses. */
  availability(): { available: boolean; reason?: string } {
    return this.firstReady() !== undefined
      ? { available: true }
      : {
          available: false,
          reason:
            'No project has an application address yet. Open it from Projects and set one up in Project settings.',
        };
  }

  summary(): { environment: string; loginRequired: boolean } {
    const ready = this.list().items.filter((c) => c.ready);
    return {
      environment: [...new Set(ready.map((c) => c.envName))].join(', '),
      loginRequired: ready.some((c) => c.login.strategy !== 'none'),
    };
  }
}
