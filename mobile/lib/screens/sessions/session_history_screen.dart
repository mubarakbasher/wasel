import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../i18n/status_format.dart';
import '../../models/session.dart';
import '../../providers/sessions_provider.dart';
import '../../theme/theme.dart';
import '../../widgets/widgets.dart';

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
        title: Text(context.tr('sessions.history')),
      ),
      body: Column(
        children: [
          _SearchFilterBar(
            searchController: _searchController,
            filterActive: state.filterTerminateCause != null,
            onSearchSubmitted: _onSearchSubmitted,
            onFilterSelected: _selectTerminateCause,
          ),
          if (state.filterTerminateCause != null)
            Padding(
              padding: const EdgeInsetsDirectional.symmetric(
                  horizontal: AppSpacing.md),
              child: Row(
                children: [
                  Chip(
                    label: Text(
                      state.filterTerminateCause!,
                      style: AppTypography.caption1,
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
                  context.tr('sessions.recordsCount',
                      [state.historyTotal.toString()]),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: AppColors.textSecondary),
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
      return ErrorState(
        message: state.error!,
        onRetry: _onRefresh,
        retryLabel: context.tr('common.retry'),
      );
    }

    if (state.historySessions.isEmpty) {
      return EmptyState(
        icon: Icons.history,
        title: context.tr('sessions.noSessionHistory'),
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

class _SearchFilterBar extends StatelessWidget {
  final TextEditingController searchController;
  final bool filterActive;
  final ValueChanged<String> onSearchSubmitted;
  final ValueChanged<String?> onFilterSelected;

  const _SearchFilterBar({
    required this.searchController,
    required this.filterActive,
    required this.onSearchSubmitted,
    required this.onFilterSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: searchController,
              decoration: InputDecoration(
                hintText: context.tr('sessions.searchUsername'),
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsetsDirectional.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                suffixIcon: searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          searchController.clear();
                          onSearchSubmitted('');
                        },
                      )
                    : null,
              ),
              onSubmitted: onSearchSubmitted,
              textInputAction: TextInputAction.search,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          PopupMenuButton<String?>(
            icon: Icon(
              Icons.filter_list,
              color: filterActive ? AppColors.primary : null,
            ),
            tooltip: context.tr('sessions.filterByTerminateCause'),
            // "All causes" uses the sentinel 'all' — a PopupMenuItem with a null
            // value is treated as a cancelled menu and never fires onSelected.
            onSelected: (v) => onFilterSelected(v == 'all' ? null : v),
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'all',
                child: Text(context.tr('sessions.allCauses')),
              ),
              const PopupMenuDivider(),
              PopupMenuItem(
                value: 'User-Request',
                child: Text(context.tr('sessions.userRequest')),
              ),
              PopupMenuItem(
                value: 'Session-Timeout',
                child: Text(context.tr('sessions.sessionTimeout')),
              ),
              PopupMenuItem(
                value: 'Idle-Timeout',
                child: Text(context.tr('sessions.idleTimeout')),
              ),
              PopupMenuItem(
                value: 'Admin-Reset',
                child: Text(context.tr('sessions.adminReset')),
              ),
              PopupMenuItem(
                value: 'NAS-Reboot',
                child: Text(context.tr('sessions.nasReboot')),
              ),
              PopupMenuItem(
                value: 'Port-Error',
                child: Text(context.tr('sessions.portError')),
              ),
              PopupMenuItem(
                value: 'Lost-Carrier',
                child: Text(context.tr('sessions.lostCarrier')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCard({required this.session});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _HistoryCardHeader(session: session),
          const SizedBox(height: AppSpacing.sm),
          _HistoryCardTimestamps(session: session),
          const SizedBox(height: AppSpacing.sm),
          _HistoryCardStats(session: session),
          if (session.framedIpAddress.isNotEmpty ||
              session.callingStationId.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            _HistoryCardMeta(session: session),
          ],
        ],
      ),
    );
  }
}

class _HistoryCardHeader extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCardHeader({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.person, size: 18, color: AppColors.primary),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            session.username,
            style: AppTypography.mono.copyWith(fontWeight: FontWeight.bold),
          ),
        ),
        if (session.terminateCause.isNotEmpty)
          StatusBadge(
            label: localizedTerminateCause(context, session.terminateCause),
            color: _causeColor(session.terminateCause),
          ),
      ],
    );
  }

  static Color _causeColor(String cause) {
    return switch (cause) {
      'User-Request' => AppColors.info,
      'Session-Timeout' => AppColors.warning,
      'Idle-Timeout' => AppColors.warning,
      'Admin-Reset' => AppColors.error,
      'NAS-Reboot' => AppColors.info,
      _ => AppColors.textSecondary,
    };
  }
}

class _HistoryCardTimestamps extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCardTimestamps({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(Icons.play_arrow, size: 14, color: AppColors.textTertiary),
        const SizedBox(width: 4),
        Text(
          session.startTime != null
              ? _formatDateTime(session.startTime!)
              : context.tr('sessions.nA'),
          style: AppTypography.caption1.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(width: AppSpacing.md),
        Icon(Icons.stop, size: 14, color: AppColors.textTertiary),
        const SizedBox(width: 4),
        Text(
          session.stopTime != null
              ? _formatDateTime(session.stopTime!)
              : context.tr('sessions.stillActive'),
          style: AppTypography.caption1.copyWith(
            color: session.stopTime != null
                ? AppColors.textSecondary
                : AppColors.success,
          ),
        ),
      ],
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

class _HistoryCardStats extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCardStats({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatChip(icon: Icons.timer, label: localizedDuration(context, session.sessionTime)),
        const SizedBox(width: AppSpacing.sm),
        _StatChip(icon: Icons.arrow_downward, label: localizedBytes(context, session.inputOctets)),
        const SizedBox(width: AppSpacing.sm),
        _StatChip(icon: Icons.arrow_upward, label: localizedBytes(context, session.outputOctets)),
      ],
    );
  }
}

class _HistoryCardMeta extends StatelessWidget {
  final SessionHistory session;

  const _HistoryCardMeta({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (session.framedIpAddress.isNotEmpty) ...[
          Icon(Icons.lan, size: 14, color: AppColors.textTertiary),
          const SizedBox(width: 4),
          Text(
            session.framedIpAddress,
            style: AppTypography.monoSmall.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
        ],
        if (session.callingStationId.isNotEmpty) ...[
          Icon(Icons.devices, size: 14, color: AppColors.textTertiary),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              session.callingStationId,
              style: AppTypography.monoSmall.copyWith(
                color: AppColors.textSecondary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ],
    );
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _StatChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppTypography.caption1.copyWith(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
