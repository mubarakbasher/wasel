import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../i18n/status_format.dart';
import '../../models/session.dart';
import '../../providers/sessions_provider.dart';
import '../../theme/theme.dart';
import '../../widgets/widgets.dart';

class ActiveSessionsScreen extends ConsumerStatefulWidget {
  final String routerId;

  const ActiveSessionsScreen({super.key, required this.routerId});

  @override
  ConsumerState<ActiveSessionsScreen> createState() =>
      _ActiveSessionsScreenState();
}

class _ActiveSessionsScreenState extends ConsumerState<ActiveSessionsScreen> {
  Timer? _autoRefreshTimer;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(sessionsProvider.notifier).loadActiveSessions(widget.routerId);
    });
    _autoRefreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      // Skip the tick while a load is already in flight (a degraded router can
      // make a call take 15-45s) so polls don't stack up.
      if (ref.read(sessionsProvider).isLoading) return;
      ref.read(sessionsProvider.notifier).loadActiveSessions(widget.routerId);
    });
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _onRefresh() async {
    await ref
        .read(sessionsProvider.notifier)
        .loadActiveSessions(widget.routerId);
  }

  Future<void> _confirmDisconnect(ActiveSession session) async {
    final confirmed = await showConfirmDialog(
      context,
      title: context.tr('sessions.disconnectTitle'),
      message: context.tr(
        'sessions.disconnectUser',
        [session.username, session.macAddress],
      ),
      confirmLabel: context.tr('sessions.disconnect'),
      cancelLabel: context.tr('common.cancel'),
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    final ok = await ref
        .read(sessionsProvider.notifier)
        .disconnectSession(widget.routerId, session.id);
    if (!mounted) return;
    if (ok) {
      AppSnackbar.success(context, context.tr('sessions.disconnectedSuccessfully'));
    } else {
      // CoA disconnect can fail (router degraded / tunnel down) — the session
      // stays in the list, so tell the operator instead of failing silently.
      AppSnackbar.error(
        context,
        ref.read(sessionsProvider).error ?? context.tr('error.unknown'),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('sessions.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _onRefresh,
          ),
        ],
      ),
      body: _buildBody(state),
    );
  }

  Widget _buildBody(SessionsState state) {
    if (state.isLoading && state.activeSessions.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.activeSessions.isEmpty) {
      return ErrorState(
        message: state.error!,
        onRetry: _onRefresh,
        retryLabel: context.tr('common.retry'),
      );
    }

    if (state.activeSessions.isEmpty) {
      return EmptyState(
        icon: Icons.wifi_off,
        title: context.tr('sessions.noActiveSessions'),
        message: context.tr('sessions.autoRefresh'),
      );
    }

    return RefreshIndicator(
      onRefresh: _onRefresh,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              children: [
                Text(
                  context.tr('sessions.activeSessionsCount',
                      [state.activeSessions.length.toString()]),
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
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
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              itemCount: state.activeSessions.length,
              itemBuilder: (context, index) {
                return _SessionCard(
                  session: state.activeSessions[index],
                  onDisconnect: () =>
                      _confirmDisconnect(state.activeSessions[index]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  final ActiveSession session;
  final VoidCallback onDisconnect;

  const _SessionCard({
    required this.session,
    required this.onDisconnect,
  });

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SessionCardHeader(session: session),
          const SizedBox(height: AppSpacing.sm),
          _SessionCardStats(session: session),
          const SizedBox(height: AppSpacing.sm),
          _SessionCardMeta(session: session),
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton.icon(
              onPressed: onDisconnect,
              icon: const Icon(Icons.power_settings_new, size: 18),
              label: Text(context.tr('sessions.disconnect')),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.error,
                padding: const EdgeInsetsDirectional.symmetric(horizontal: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionCardHeader extends StatelessWidget {
  final ActiveSession session;

  const _SessionCardHeader({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.person, size: 20, color: AppColors.primary),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            session.username,
            style: AppTypography.mono.copyWith(fontWeight: FontWeight.bold),
          ),
        ),
        StatusBadge(
          label: context.tr('sessions.active'),
          color: AppColors.success,
        ),
      ],
    );
  }
}

class _SessionCardStats extends StatelessWidget {
  final ActiveSession session;

  const _SessionCardStats({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _InfoChip(icon: Icons.timer, label: session.uptime),
        const SizedBox(width: AppSpacing.sm),
        _InfoChip(icon: Icons.arrow_downward, label: localizedBytes(context, session.bytesIn)),
        const SizedBox(width: AppSpacing.sm),
        _InfoChip(icon: Icons.arrow_upward, label: localizedBytes(context, session.bytesOut)),
      ],
    );
  }
}

class _SessionCardMeta extends StatelessWidget {
  final ActiveSession session;

  const _SessionCardMeta({required this.session});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(Icons.lan, size: 14, color: AppColors.textTertiary),
        const SizedBox(width: 4),
        Text(
          session.address,
          style: AppTypography.monoSmall.copyWith(
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Icon(Icons.devices, size: 14, color: AppColors.textTertiary),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            session.macAddress,
            style: AppTypography.monoSmall.copyWith(
              color: AppColors.textSecondary,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

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
