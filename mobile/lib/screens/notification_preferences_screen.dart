import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/notification_prefs_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

class NotificationPreferencesScreen extends ConsumerStatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  ConsumerState<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends ConsumerState<NotificationPreferencesScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(notificationPrefsProvider.notifier).loadPreferences());
  }

  IconData _iconForCategory(String category) {
    switch (category) {
      case 'subscription_expiring':
        return Icons.timer_outlined;
      case 'subscription_expired':
        return Icons.timer_off_outlined;
      case 'payment_confirmed':
        return Icons.payment_outlined;
      case 'router_offline':
        return Icons.wifi_off;
      case 'router_online':
        return Icons.wifi;
      case 'voucher_quota_low':
        return Icons.warning_amber;
      case 'bulk_creation_complete':
        return Icons.content_copy;
      default:
        return Icons.notifications_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(notificationPrefsProvider);
    final notifier = ref.read(notificationPrefsProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: _buildBody(state, notifier),
    );
  }

  Widget _buildBody(NotificationPrefsState state, NotificationPrefsNotifier notifier) {
    if (state.isLoading && state.preferences.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.preferences.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                state.error!,
                style: AppTypography.body.copyWith(color: AppColors.error),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.md),
              ElevatedButton(
                onPressed: () => notifier.loadPreferences(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    // Group preferences by section
    final grouped = <String, List<dynamic>>{};
    for (final pref in state.preferences) {
      grouped.putIfAbsent(pref.sectionName, () => []).add(pref);
    }

    // Ordered sections
    const sectionOrder = ['Subscription', 'Routers', 'Vouchers'];
    final orderedSections =
        sectionOrder.where((s) => grouped.containsKey(s)).toList();

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      itemCount: orderedSections.length,
      itemBuilder: (context, index) {
        final section = orderedSections[index];
        final prefs = grouped[section]!;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xs),
              child: Text(
                section.toUpperCase(),
                style: AppTypography.caption1.copyWith(
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            ...prefs.map((pref) => SwitchListTile(
                  secondary: Icon(
                    _iconForCategory(pref.category),
                    color: AppColors.primary,
                  ),
                  title: Text(pref.displayName, style: AppTypography.body),
                  value: pref.enabled,
                  activeColor: AppColors.primary,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                  onChanged: (value) =>
                      notifier.togglePreference(pref.category, value),
                )),
          ],
        );
      },
    );
  }
}
