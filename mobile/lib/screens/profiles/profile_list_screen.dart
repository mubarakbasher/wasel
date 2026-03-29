import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/radius_profile.dart';
import '../../providers/profiles_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class ProfileListScreen extends ConsumerStatefulWidget {
  const ProfileListScreen({super.key});

  @override
  ConsumerState<ProfileListScreen> createState() => _ProfileListScreenState();
}

class _ProfileListScreenState extends ConsumerState<ProfileListScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(profilesProvider.notifier).loadProfiles());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(profilesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('RADIUS Profiles'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => context.push('/profiles/create'),
          ),
        ],
      ),
      body: state.isLoading && state.profiles.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && state.profiles.isEmpty
              ? _buildError(state.error!)
              : state.profiles.isEmpty
                  ? _buildEmpty()
                  : _buildList(state),
    );
  }

  Widget _buildError(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: AppSpacing.lg),
            Text(error, style: AppTypography.body, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: () =>
                    ref.read(profilesProvider.notifier).loadProfiles(),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.tune, size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text('No Profiles Yet',
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Create a RADIUS profile to define bandwidth, time, and data limits for your vouchers.',
              style:
                  AppTypography.subhead.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => context.push('/profiles/create'),
                icon: const Icon(Icons.add),
                label: const Text('Create Profile'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(ProfilesState state) {
    return RefreshIndicator(
      onRefresh: () => ref.read(profilesProvider.notifier).loadProfiles(),
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: state.profiles.length,
        itemBuilder: (context, index) {
          final profile = state.profiles[index];
          return _ProfileCard(
            profile: profile,
            onTap: () => context.push('/profiles/detail', extra: profile.id),
          );
        },
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  final RadiusProfile profile;
  final VoidCallback onTap;

  const _ProfileCard({required this.profile, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  ),
                  child: Icon(Icons.tune, size: 20, color: AppColors.primary),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(profile.displayName, style: AppTypography.title3),
                      const SizedBox(height: 2),
                      Text(
                        profile.groupName,
                        style: AppTypography.caption1
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right,
                    color: AppColors.textTertiary, size: 20),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              children: [
                _LimitChip(
                  icon: Icons.speed,
                  label: profile.bandwidthDisplay,
                ),
                _LimitChip(
                  icon: Icons.timer,
                  label: profile.sessionTimeoutDisplay,
                ),
                _LimitChip(
                  icon: Icons.schedule,
                  label: profile.totalTimeDisplay,
                ),
                _LimitChip(
                  icon: Icons.data_usage,
                  label: profile.totalDataDisplay,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _LimitChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _LimitChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Text(
            label,
            style:
                AppTypography.caption2.copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}
