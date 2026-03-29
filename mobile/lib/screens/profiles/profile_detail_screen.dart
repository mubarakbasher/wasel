import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/radius_profile.dart';
import '../../providers/profiles_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class ProfileDetailScreen extends ConsumerStatefulWidget {
  final String profileId;

  const ProfileDetailScreen({super.key, required this.profileId});

  @override
  ConsumerState<ProfileDetailScreen> createState() =>
      _ProfileDetailScreenState();
}

class _ProfileDetailScreenState extends ConsumerState<ProfileDetailScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(profilesProvider.notifier).loadProfile(widget.profileId));
  }

  Future<void> _deleteProfile() async {
    final profile = ref.read(profilesProvider).selectedProfile;
    if (profile == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Profile?'),
        content: Text(
          "Are you sure you want to delete '${profile.displayName}'? This will remove all associated RADIUS group attributes. Profiles with assigned vouchers cannot be deleted.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final success =
        await ref.read(profilesProvider.notifier).deleteProfile(profile.id);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile deleted successfully')),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(profilesProvider);
    final profile = state.selectedProfile;

    return Scaffold(
      appBar: AppBar(
        title: Text(profile?.displayName ?? 'Profile Details'),
        actions: [
          if (profile != null) ...[
            IconButton(
              icon: const Icon(Icons.edit),
              onPressed: () =>
                  context.push('/profiles/edit', extra: profile.id),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: _deleteProfile,
            ),
          ],
        ],
      ),
      body: state.isLoading && profile == null
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && profile == null
              ? _buildError(state.error!)
              : profile == null
                  ? Center(
                      child: Text('Profile not found',
                          style: AppTypography.body
                              .copyWith(color: AppColors.textSecondary)),
                    )
                  : RefreshIndicator(
                      onRefresh: () => ref
                          .read(profilesProvider.notifier)
                          .loadProfile(widget.profileId),
                      child: ListView(
                        padding: const EdgeInsets.all(AppSpacing.lg),
                        children: [
                          if (state.error != null) ...[
                            Container(
                              padding: const EdgeInsets.all(AppSpacing.md),
                              decoration: BoxDecoration(
                                color: AppColors.error.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(
                                    AppSpacing.radiusMd),
                              ),
                              child: Text(
                                state.error!,
                                style: AppTypography.subhead
                                    .copyWith(color: AppColors.error),
                              ),
                            ),
                            const SizedBox(height: AppSpacing.lg),
                          ],
                          _buildInfoCard(profile),
                          const SizedBox(height: AppSpacing.lg),
                          _buildLimitsCard(profile),
                          const SizedBox(height: AppSpacing.lg),
                          if (profile.radiusAttributes.isNotEmpty) ...[
                            _buildRadiusAttributesCard(profile),
                            const SizedBox(height: AppSpacing.lg),
                          ],
                          _buildActionsCard(profile),
                        ],
                      ),
                    ),
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
                onPressed: () => ref
                    .read(profilesProvider.notifier)
                    .loadProfile(widget.profileId),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard(RadiusProfile profile) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
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
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Icon(Icons.tune, size: 28, color: AppColors.primary),
              ),
              const SizedBox(width: AppSpacing.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(profile.displayName, style: AppTypography.title2),
                    const SizedBox(height: 4),
                    Text(
                      profile.groupName,
                      style: AppTypography.subhead
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
            label: 'Created',
            value: _formatDate(profile.createdAt),
            icon: Icons.calendar_today,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Updated',
            value: _formatDate(profile.updatedAt),
            icon: Icons.update,
          ),
        ],
      ),
    );
  }

  Widget _buildLimitsCard(RadiusProfile profile) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Limits', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
            label: 'Bandwidth',
            value: profile.bandwidthDisplay,
            icon: Icons.speed,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Session Timeout',
            value: profile.sessionTimeoutDisplay,
            icon: Icons.timer,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Total Time',
            value: profile.totalTimeDisplay,
            icon: Icons.schedule,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Total Data',
            value: profile.totalDataDisplay,
            icon: Icons.data_usage,
          ),
        ],
      ),
    );
  }

  Widget _buildRadiusAttributesCard(RadiusProfile profile) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('RADIUS Attributes', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          ...profile.radiusAttributes.map((attr) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius:
                        BorderRadius.circular(AppSpacing.radiusMd),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.sm,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: attr.type == 'check'
                              ? AppColors.primaryLight
                              : AppColors.secondaryLight,
                          borderRadius:
                              BorderRadius.circular(AppSpacing.radiusSm),
                        ),
                        child: Text(
                          attr.type,
                          style: AppTypography.caption2.copyWith(
                            color: attr.type == 'check'
                                ? AppColors.primary
                                : AppColors.secondary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          '${attr.attribute} ${attr.op} ${attr.value}',
                          style: AppTypography.footnote.copyWith(
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              )),
        ],
      ),
    );
  }

  Widget _buildActionsCard(RadiusProfile profile) {
    return Column(
      children: [
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () =>
                context.push('/profiles/edit', extra: profile.id),
            icon: const Icon(Icons.edit),
            label: const Text('Edit Profile'),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _deleteProfile,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.error,
              side: BorderSide(color: AppColors.error.withValues(alpha: 0.5)),
            ),
            icon: const Icon(Icons.delete_outline),
            label: const Text('Delete Profile'),
          ),
        ),
      ],
    );
  }

  String _formatDate(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textSecondary),
        const SizedBox(width: AppSpacing.sm),
        Text(label,
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary)),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            style:
                AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
