/*
 * Copyright (C) 2024 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef SRC_TRACE_PROCESSOR_PERFETTO_SQL_INTRINSICS_TABLE_FUNCTIONS_DFS_WEIGHT_BOUNDED_H_
#define SRC_TRACE_PROCESSOR_PERFETTO_SQL_INTRINSICS_TABLE_FUNCTIONS_DFS_WEIGHT_BOUNDED_H_

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "perfetto/ext/base/status_or.h"
#include "perfetto/trace_processor/basic_types.h"
#include "src/trace_processor/containers/string_pool.h"
#include "src/trace_processor/db/table.h"
#include "src/trace_processor/perfetto_sql/intrinsics/table_functions/static_table_function.h"

namespace perfetto::trace_processor {

// An SQL table-function which performs a weight bounded DFS from a set of start
// nodes in a graph and returns all the nodes which are reachable from each
// start node independently.
//
// Arguments:
//  1) |source_node_ids|: RepeatedBuilderResult proto containing a column of
//     uint32 values corresponding to the source of edges.
//  2) |dest_node_ids|:  RepeatedBuilderResult proto containing a column of
//     uint32 values corresponding to the destination of edges. This number of
//     values should be the same as |source_node_ids| with each index in
//     |source_node_ids| acting as the source for the corresponding index in
//     |dest_node_ids|.
//  3) |edge_weights|:  RepeatedBuilderResult proto containing a column of
//     uint32 values corresponding to the weight of edges. This number of
//     values should be the same as |source_node_ids| with each index in
//     |source_node_ids| acting as the source for the corresponding index in
//     |edge_weights|.
//  4) |root_node_ids|: RepeatedBuilderResult proto containing a column of
//     uint32 values corresponding to the ID of the start nodes in the graph
//     from which reachability should be computed.
//  5) |root_max_weights|: RepeatedBuilderResult proto containing a column of
//     uint32 values corresponding to the max sum of edge weights inclusive,
//     at which point the DFS from the |root_node_ids| stops. This number of
//     values should be the same as |root_node_ids|.
//
// Returns:
//  A table with the nodes reachable from the start node, their "parent" in
//  the tree generated by the DFS and the starting node itself "root". The
//  schema of the table is (root_node_id uint32_t, node_id uint32_t,
//  parent_node_id optional<uint32_t>).
//
// Note: this function is not intended to be used directly from SQL: instead
// macros exist in the standard library, wrapping it and making it
// user-friendly.
class DfsWeightBounded : public StaticTableFunction {
 public:
  explicit DfsWeightBounded(StringPool*);
  virtual ~DfsWeightBounded() override;

  // StaticTableFunction implementation.
  Table::Schema CreateSchema() override;
  std::string TableName() override;
  uint32_t EstimateRowCount() override;
  base::StatusOr<std::unique_ptr<Table>> ComputeTable(
      const std::vector<SqlValue>& arguments) override;

 private:
  StringPool* pool_ = nullptr;
};

}  // namespace perfetto::trace_processor

#endif  // SRC_TRACE_PROCESSOR_PERFETTO_SQL_INTRINSICS_TABLE_FUNCTIONS_DFS_WEIGHT_BOUNDED_H_