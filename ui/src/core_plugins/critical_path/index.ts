// Copyright (C) 2024 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  getThreadInfo,
  ThreadInfo,
} from '../../trace_processor/sql_utils/thread';

import {
  addDebugSliceTrack,
  Engine,
  PerfettoPlugin,
  PluginContextTrace,
  PluginDescriptor,
  THREAD_STATE_TRACK_KIND,
} from '../../public';
import {
  getTimeSpanOfSelectionOrVisibleWindow,
  globals,
} from '../../frontend/globals';
import {asUtid, Utid} from '../../trace_processor/sql_utils/core_types';
import {addQueryResultsTab} from '../../frontend/query_result_tab';
import {showModal} from '../../widgets/modal';
import {Optional} from '../../base/utils';
import {
  CRITICAL_PATH_CMD,
  CRITICAL_PATH_LITE_CMD,
} from '../../public/exposed_commands';

const criticalPathSliceColumns = {
  ts: 'ts',
  dur: 'dur',
  name: 'name',
};

const criticalPathsliceColumnNames = [
  'id',
  'utid',
  'ts',
  'dur',
  'name',
  'table_name',
];

const criticalPathsliceLiteColumns = {
  ts: 'ts',
  dur: 'dur',
  name: 'thread_name',
};

const criticalPathsliceLiteColumnNames = [
  'id',
  'utid',
  'ts',
  'dur',
  'thread_name',
  'process_name',
  'table_name',
];

const sliceLiteColumns = {ts: 'ts', dur: 'dur', name: 'thread_name'};

const sliceLiteColumnNames = [
  'id',
  'utid',
  'ts',
  'dur',
  'thread_name',
  'process_name',
  'table_name',
];

const sliceColumns = {ts: 'ts', dur: 'dur', name: 'name'};

const sliceColumnNames = ['id', 'utid', 'ts', 'dur', 'name', 'table_name'];

function getFirstUtidOfSelectionOrVisibleWindow(): number {
  const selection = globals.state.selection;
  if (selection.kind === 'area') {
    for (const trackUri of selection.trackUris) {
      const trackDesc = globals.trackManager.getTrack(trackUri);
      if (
        trackDesc?.tags?.kind === THREAD_STATE_TRACK_KIND &&
        trackDesc?.tags?.utid !== undefined
      ) {
        return trackDesc.tags.utid;
      }
    }
  }

  return 0;
}

function showModalErrorAreaSelectionRequired() {
  showModal({
    title: 'Error: range selection required',
    content:
      'This command requires an area selection over a thread state track.',
  });
}

function showModalErrorThreadStateRequired() {
  showModal({
    title: 'Error: thread state selection required',
    content: 'This command requires a thread state slice to be selected.',
  });
}

// If utid is undefined, returns the utid for the selected thread state track,
// if any. If it's defined, looks up the info about that specific utid.
async function getThreadInfoForUtidOrSelection(
  engine: Engine,
  utid?: Utid,
): Promise<Optional<ThreadInfo>> {
  if (utid === undefined) {
    if (
      globals.state.selection.kind !== 'legacy' ||
      globals.state.selection.legacySelection.kind !== 'THREAD_STATE'
    ) {
      return undefined;
    }
    const trackUri = globals.state.selection.legacySelection.trackUri;
    if (trackUri === undefined) return undefined;
    const track = globals.trackManager.getTrack(trackUri);
    utid = asUtid(track?.tags?.utid);
    if (utid === undefined) return undefined;
  }
  return getThreadInfo(engine, utid);
}

class CriticalPath implements PerfettoPlugin {
  async onTraceLoad(ctx: PluginContextTrace): Promise<void> {
    // The 3 commands below are used in two contextes:
    // 1. By clicking a slice and using the command palette. In this case the
    //    utid argument is undefined and we need to look at the selection.
    // 2. Invoked via runCommand(...) by thread_state_tab.ts when the user
    //    clicks on the buttons in the details panel. In this case the details
    //    panel passes the utid explicitly.
    ctx.registerCommand({
      id: CRITICAL_PATH_LITE_CMD,
      name: 'Critical path lite (selected thread state slice)',
      callback: async (utid?: Utid) => {
        const thdInfo = await getThreadInfoForUtidOrSelection(ctx.engine, utid);
        if (thdInfo === undefined) {
          return showModalErrorThreadStateRequired();
        }
        ctx.engine
          .query(`INCLUDE PERFETTO MODULE sched.thread_executing_span;`)
          .then(() =>
            addDebugSliceTrack(
              ctx,
              {
                sqlSource: `
                SELECT
                  cr.id,
                  cr.utid,
                  cr.ts,
                  cr.dur,
                  thread.name AS thread_name,
                  process.name AS process_name,
                  'thread_state' AS table_name
                FROM
                  _thread_executing_span_critical_path(
                    ${thdInfo.utid},
                    trace_bounds.start_ts,
                    trace_bounds.end_ts - trace_bounds.start_ts) cr,
                  trace_bounds
                JOIN thread USING(utid)
                JOIN process USING(upid)
              `,
                columns: sliceLiteColumnNames,
              },
              `${thdInfo.name}`,
              sliceLiteColumns,
              sliceLiteColumnNames,
            ),
          );
      },
    });

    ctx.registerCommand({
      id: CRITICAL_PATH_CMD,
      name: 'Critical path (selected thread state slice)',
      callback: async (utid?: Utid) => {
        const thdInfo = await getThreadInfoForUtidOrSelection(ctx.engine, utid);
        if (thdInfo === undefined) {
          return showModalErrorThreadStateRequired();
        }
        ctx.engine
          .query(
            `INCLUDE PERFETTO MODULE sched.thread_executing_span_with_slice;`,
          )
          .then(() =>
            addDebugSliceTrack(
              ctx,
              {
                sqlSource: `
                SELECT cr.id, cr.utid, cr.ts, cr.dur, cr.name, cr.table_name
                  FROM
                    _thread_executing_span_critical_path_stack(
                      ${thdInfo.utid},
                      trace_bounds.start_ts,
                      trace_bounds.end_ts - trace_bounds.start_ts) cr,
                    trace_bounds WHERE name IS NOT NULL
              `,
                columns: sliceColumnNames,
              },
              `${thdInfo.name}`,
              sliceColumns,
              sliceColumnNames,
            ),
          );
      },
    });

    ctx.registerCommand({
      id: 'perfetto.CriticalPathLite_AreaSelection',
      name: 'Critical path lite (over area selection)',
      callback: async () => {
        const trackUtid = getFirstUtidOfSelectionOrVisibleWindow();
        const window = await getTimeSpanOfSelectionOrVisibleWindow();
        if (trackUtid === 0) {
          return showModalErrorAreaSelectionRequired();
        }
        await ctx.engine.query(
          `INCLUDE PERFETTO MODULE sched.thread_executing_span;`,
        );
        await addDebugSliceTrack(
          ctx,
          {
            sqlSource: `
                SELECT
                  cr.id,
                  cr.utid,
                  cr.ts,
                  cr.dur,
                  thread.name AS thread_name,
                  process.name AS process_name,
                  'thread_state' AS table_name
                FROM
                  _thread_executing_span_critical_path(
                      ${trackUtid},
                      ${window.start},
                      ${window.end} - ${window.start}) cr
                JOIN thread USING(utid)
                JOIN process USING(upid)
                `,
            columns: criticalPathsliceLiteColumnNames,
          },
          (await getThreadInfo(ctx.engine, trackUtid as Utid)).name ??
            '<thread name>',
          criticalPathsliceLiteColumns,
          criticalPathsliceLiteColumnNames,
        );
      },
    });

    ctx.registerCommand({
      id: 'perfetto.CriticalPath_AreaSelection',
      name: 'Critical path  (over area selection)',
      callback: async () => {
        const trackUtid = getFirstUtidOfSelectionOrVisibleWindow();
        const window = await getTimeSpanOfSelectionOrVisibleWindow();
        if (trackUtid === 0) {
          return showModalErrorAreaSelectionRequired();
        }
        await ctx.engine.query(
          `INCLUDE PERFETTO MODULE sched.thread_executing_span_with_slice;`,
        );
        await addDebugSliceTrack(
          ctx,
          {
            sqlSource: `
                SELECT cr.id, cr.utid, cr.ts, cr.dur, cr.name, cr.table_name
                FROM
                _critical_path_stack(
                  ${trackUtid},
                  ${window.start},
                  ${window.end} - ${window.start}, 1, 1, 1, 1) cr
                WHERE name IS NOT NULL
                `,
            columns: criticalPathsliceColumnNames,
          },
          (await getThreadInfo(ctx.engine, trackUtid as Utid)).name ??
            '<thread name>',
          criticalPathSliceColumns,
          criticalPathsliceColumnNames,
        );
      },
    });

    ctx.registerCommand({
      id: 'perfetto.CriticalPathPprof_AreaSelection',
      name: 'Critical path pprof (over area selection)',
      callback: async () => {
        const trackUtid = getFirstUtidOfSelectionOrVisibleWindow();
        const window = await getTimeSpanOfSelectionOrVisibleWindow();
        if (trackUtid === 0) {
          return showModalErrorAreaSelectionRequired();
        }
        addQueryResultsTab({
          query: `
              INCLUDE PERFETTO MODULE sched.thread_executing_span_with_slice;
              SELECT *
                FROM
                  _thread_executing_span_critical_path_graph(
                  "criical_path",
                    ${trackUtid},
                    ${window.start},
                    ${window.end} - ${window.start}) cr`,
          title: 'Critical path',
        });
      },
    });
  }
}

export const plugin: PluginDescriptor = {
  pluginId: 'perfetto.CriticalPath',
  plugin: CriticalPath,
};
