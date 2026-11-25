import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { AppService } from './app.service';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('scheduler/status')
  async getSchedulerStatus(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const folder = join(process.cwd(), 'logs', 'erapower-sync');
    let last: any = null;
    try {
      last = JSON.parse(await readFile(join(folder, 'latest.json'), 'utf8'));
    } catch { /* A remote deployment may have no local scheduler logs. */ }
    let running = false;
    try {
      const pid = Number(await readFile(join(folder, 'running.lock'), 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0) { process.kill(pid, 0); running = true; }
    } catch { /* An absent or stale lock means no active local run. */ }
    let progress: any = null;
    if (running) {
      try { progress = JSON.parse(await readFile(join(folder, 'progress.json'), 'utf8')); } catch {}
    }
    let published: any = null;
    if (progress?.runId) {
      try {
        const candidate = JSON.parse(await readFile(join(folder, 'published-progress.json'), 'utf8'));
        if (candidate.runId === progress.runId) published = candidate;
      } catch { /* A new run may not have published its first stage yet. */ }
    }
    let schedule: any = null;
    if (process.platform === 'win32') {
      try {
        const { stdout } = await promisify(execFile)('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          "$ErrorActionPreference='Stop'; $t=Get-ScheduledTask -TaskName 'Purnell-eraPower-Sync-3h'; $i=Get-ScheduledTaskInfo -TaskName $t.TaskName; @{state=[string]$t.State; nextRun=$i.NextRunTime.ToUniversalTime().ToString('o'); lastRun=$i.LastRunTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress",
        ], { timeout: 5000, windowsHide: true });
        schedule = JSON.parse(stdout);
      } catch { /* Return saved run results if Task Scheduler is inaccessible. */ }
    }
    const datasets = running
      ? (Array.isArray(published?.datasets) ? published.datasets : [])
      : (Array.isArray(last?.result?.datasets) ? last.result.datasets : []);
    return {
      intervalHours: 3, timezone: 'Australia/Sydney', running,
      activeStage: progress?.stage ?? null,
      scheduleState: schedule?.state ?? 'Unavailable on this server',
      lastRun: progress?.startedAt ?? last?.startedAt ?? schedule?.lastRun ?? last?.runId?.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z') ?? null,
      nextRun: schedule?.nextRun ?? null,
      completedAt: running ? null : last?.completedAt ?? null,
      result: last ? (last.success ? 'Success' : last.partial ? 'Partial' : 'Failed') : 'No run recorded on this server',
      limitations: Array.isArray(last?.limitations) ? last.limitations : [],
      failedStage: !running && last?.success === false ? last.stage : null,
      insertedRows: datasets.reduce((total: number, item: any) => total + (Number(item.new_rows) || 0), 0),
      updatedRows: datasets.reduce((total: number, item: any) => total + (Number(item.updated_rows) || 0), 0),
      datasets: datasets.map((item: any) => ({
        collection: item.collection, inserted: Number(item.new_rows) || 0, updated: Number(item.updated_rows) || 0,
        existingSkipped: Number(item.already_present) || 0,
      })),
    };
  }

  @Get()
  getHome(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), 'public', 'index.html'));
  }

  @Get('health')
  getHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}


