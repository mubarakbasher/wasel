import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/session.dart';
import '../../providers/sessions_provider.dart';
import '../../theme/theme.dart';

class SessionHistoryScreen extends ConsumerStatefulWidget {
  final String routerId;

  const SessionHistoryScreen({super.key, required this.routerId});

  @override
  ConsumerState<SessionHistoryScreen> createState() =>
      _SessionHistoryScreenState();
}

class _SessionHistoryScreenState extends ConsumerState<SessionHistoryScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref
          .read(sessionsProvider.notifier)
          .loadSessionHistory(widget.routerId, refresh: true);
    });
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(sessionsProvider.notifier).loadMoreHistory(widget.routerId);
    }
  }

  Future<void> _onRefresh() async {
    await ref
        .read(sessionsProvider.notifier)
        .loadSessionHistory(widget.routerId, refresh: true);
  }

  void _onSearchSubmitted(String value) {
    ref.read(sessionsProvider.notifier).setUsernameFilter(value);
    ref
        .read(sessionsProvider.notifier)
        .loadSessionHistory(widget.routerId, refresh: true);
  }

  void _selectTerminateCause(String? cause) {
    ref.read(sessionsProvider.notifier).setTerminateCauseFilter(cause);
    ref
        .read(sessionsProvider.notifier)
        .loadSessionHistory(widget.routerId, refresh: true);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Session History'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search username...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      suffixIcon: _searchController.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchController.clear();
                                _onSearchSubmitted('');
                              },
                            )
                          : null,
                    ),
                    onSubmitted: _onSearchSubmitted,
                    textInputAction: TextInputAction.search,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                PopupMenuButton<String?>(
                  icon: Icon(
                    Icons.filter_list,
                    color: state.filterTerminateCause != null
                        ? AppColors.primary
                        : null,
                  ),
                  tooltip: 'Filter by terminate cause',
                  onSelected: _selectTerminateCause,
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: null,
                      child: Text('All causes'),
                    ),
                    const PopupMenuDivider(),
                    const PopupMenuItem(
                      value: 'User-Request',
                      child: Text('User Request'),
                    ),
                    const PopupMenuItem(
                      value: 'Session-Timeout',
                      child: Text('Session Timeout'),
                    ),
                    const PopupMenuItem(
                      value: 'Idle-Timeout',
                      child: Text('Idle Timeout'),
                    ),
                    const PopupMenuItem(
                      value: 'Admin-Reset',
                      child: Text('Admin Reset'),
                    ),
                    const PopupMenuItem(
                      value: 'NAS-Reboot',
                      child: Text('NAS Reboot'),
                    ),
                    const PopupMenuItem(
                      value: 'Port-Error',
                      child: Text('Port Error'),
                    ),
                    const PopupMenuItem(
                      value: 'Lost-Carrier',
                      child: Text('Lost Carrier'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (state.filterTerminateCause != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Row(
                children: [
                  Chip(
                    label: Text(
                      state.filterTerminateCause!,
                      style: const TextStyle(fontSize: 12),
                    ),
                    deleteIcon: const Icon(Icons.close, size: 16),
                    onDeleted: () => _selectTerminateCause(null),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.xs,
            ),
            child: Row(
              children: [
                Text(
                  '${state.historyTotal} record${state.historyTotal == 1 ? "" : "s"}',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Colors.grey[600]),
                ),
                const Spacer(),
                if (state.isLoading)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
          Expanded(child: _buildContent(state)),
        ],
      ),
    );
  }

  Widget _buildContent(SessionsState state) {
    if (state.isLoading && state.historySessions.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.historySessions.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: Colors.red[300]),
              const SizedBox(height: AppSpacing.md),
              Text(
                state.error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.red[700]),
              ),
              const SizedBox(height: AppSpacing.md),
              ElevatedButton(
                onPressed: _onRefresh,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (state.historySessions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history, size: 64, color: Colors.grey[400]),
            const SizedBox(height: AppSpacing.md),
            Text(
              'No session history',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(color: Colors.grey[600]),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _onRefresh,
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        itemCount:
            state.historySessions.length + (state.hasMoreHistory ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= state.historySessions.length) {
            return const Padding(
              padding: EdgeInsets.all(AppSpacing.md),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return _HistoryCard(session: state.historySessions[index]);
        },
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCard({required this.session});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.person, size: 18, color: AppColors.primary),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    session.username,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),
                _TerminateCauseBadge(cause: session.terminateCause),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Icon(Icons.play_arrow, size: 14, color: Colors.grey[500]),
                const SizedBox(width: 4),
                Text(
                  session.startTime != null
                      ? _formatDateTime(session.startTime!)
                      : 'N/A',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Colors.grey[600]),
                ),
                const SizedBox(width: AppSpacing.md),
                Icon(Icons.stop, size: 14, color: Colors.grey[500]),
                const SizedBox(width: 4),
                Text(
                  session.stopTime != null
                      ? _formatDateTime(session.stopTime!)
                      : 'Still active',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: session.stopTime != null
                            ? Colors.grey[600]
                            : Colors.green[700],
                      ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                _StatChip(
                  icon: Icons.timer,
                  label: session.sessionTimeDisplay,
                ),
                const SizedBox(width: AppSpacing.sm),
                _StatChip(
                  icon: Icons.arrow_downward,
                  label: session.inputDisplay,
                ),
                const SizedBox(width: AppSpacing.sm),
                _StatChip(
                  icon: Icons.arrow_upward,
                  label: session.outputDisplay,
                ),
              ],
            ),
            if (session.framedIpAddress.isNotEmpty ||
                session.callingStationId.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  if (session.framedIpAddress.isNotEmpty) ...[
                    Icon(Icons.lan, size: 14, color: Colors.grey[500]),
                    const SizedBox(width: 4),
                    Text(
                      session.framedIpAddress,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: Colors.grey[600]),
                    ),
                    const SizedBox(width: AppSpacing.md),
                  ],
                  if (session.callingStationId.isNotEmpty) ...[
                    Icon(Icons.devices, size: 14, color: Colors.grey[500]),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        session.callingStationId,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Colors.grey[600],
                              fontFamily: 'monospace',
                            ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    final day = dt.day.toString().padLeft(2, '0');
    final month = dt.month.toString().padLeft(2, '0');
    final hour = dt.hour.toString().padLeft(2, '0');
    final minute = dt.minute.toString().padLeft(2, '0');
    return '$day/$month $hour:$minute';
  }
}

class _TerminateCauseBadge extends StatelessWidget {
  final String cause;

  const _TerminateCauseBadge({required this.cause});

  @override
  Widget build(BuildContext context) {
    if (cause.isEmpty) return const SizedBox.shrink();

    final (color, bgColor) = _causeColors(cause);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        cause,
        style: TextStyle(
          fontSize: 10,
          color: color,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  (Color, Color) _causeColors(String cause) {
    return switch (cause) {
      'User-Request' => (Colors.blue[700]!, Colors.blue[50]!),
      'Session-Timeout' => (Colors.orange[700]!, Colors.orange[50]!),
      'Idle-Timeout' => (Colors.amber[700]!, Colors.amber[50]!),
      'Admin-Reset' => (Colors.red[700]!, Colors.red[50]!),
      'NAS-Reboot' => (Colors.purple[700]!, Colors.purple[50]!),
      'Lost-Carrier' => (Colors.grey[700]!, Colors.grey[100]!),
      _ => (Colors.grey[700]!, Colors.grey[100]!),
    };
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _StatChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.grey[600]),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Colors.grey[700],
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
