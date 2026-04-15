import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_provider.dart';
import '../providers/locale_provider.dart';
import '../providers/subscription_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(subscriptionProvider.notifier).loadSubscription());
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final subState = ref.watch(subscriptionProvider);
    final user = authState.user;
    final sub = subState.subscription;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        children: [
          // User info header
          if (user != null)
            Container(
              margin: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.primaryLight,
                    child: Text(
                      user.name.isNotEmpty
                          ? user.name[0].toUpperCase()
                          : '?',
                      style: AppTypography.title2.copyWith(
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.name, style: AppTypography.headline),
                        Text(user.email, style: AppTypography.footnote),
                      ],
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: AppSpacing.sm),

          // Subscription section
          _SectionHeader(title: 'Subscription'),
          _SettingsTile(
            icon: Icons.card_membership,
            title: 'Subscription',
            subtitle: sub != null
                ? '${sub.planName} — ${sub.status.toUpperCase()}'
                : 'No active subscription',
            trailing: sub != null && sub.isActive
                ? Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.successLight,
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                    child: Text(
                      '${sub.daysRemaining}d left',
                      style: AppTypography.caption1.copyWith(
                        color: AppColors.success,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  )
                : null,
            onTap: () => context.push('/subscription'),
          ),
          _SettingsTile(
            icon: Icons.shopping_cart_outlined,
            title: 'View Plans',
            subtitle: 'Starter, Professional, Enterprise',
            onTap: () => context.push('/subscription/plans'),
          ),

          const SizedBox(height: AppSpacing.sm),

          // Account section
          _SectionHeader(title: 'Account'),
          _SettingsTile(
            icon: Icons.person_outline,
            title: 'Profile',
            subtitle: 'Edit your account details',
            onTap: () => context.push('/settings/profile'),
          ),
          _SettingsTile(
            icon: Icons.lock_outline,
            title: 'Change Password',
            subtitle: 'Update your password',
            onTap: () => context.push('/settings/change-password'),
          ),

          const SizedBox(height: AppSpacing.sm),

          // App section
          _SectionHeader(title: 'App'),
          _SettingsTile(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Manage push notification preferences',
            onTap: () => context.push('/notification-preferences'),
          ),
          _LanguageTile(),
          _SettingsTile(
            icon: Icons.info_outline,
            title: 'About',
            subtitle: 'Version 1.0.0',
            onTap: () {
              showAboutDialog(
                context: context,
                applicationName: 'Wasel',
                applicationVersion: '1.0.0',
                applicationIcon: const Icon(
                  Icons.wifi_tethering,
                  size: 48,
                  color: AppColors.primary,
                ),
                children: const [
                  Text(
                    'Wasel is a WiFi hotspot management platform that helps '
                    'businesses create, manage, and monitor internet access '
                    'vouchers for their MikroTik routers.',
                  ),
                ],
              );
            },
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Logout
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: () async {
                  final nav = GoRouter.of(context);
                  await ref.read(authProvider.notifier).logout();
                  if (mounted) nav.go('/login');
                },
                icon: const Icon(Icons.logout, color: AppColors.error),
                label: Text(
                  'Logout',
                  style: TextStyle(color: AppColors.error),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppColors.error),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xxxl),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xs),
      child: Text(
        title.toUpperCase(),
        style: AppTypography.caption1.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _LanguageTile extends ConsumerWidget {
  const _LanguageTile();

  static const _languages = [
    (code: null, label: 'System Default', native: 'System Default'),
    (code: 'en', label: 'English', native: 'English'),
    (code: 'ar', label: 'Arabic', native: 'العربية'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentLocale = ref.watch(localeProvider);
    final currentLabel = currentLocale == null
        ? 'System Default'
        : _languages
            .firstWhere(
              (l) => l.code == currentLocale.languageCode,
              orElse: () => _languages.first,
            )
            .native;

    return ListTile(
      leading: const Icon(Icons.language, color: AppColors.primary),
      title: Text('Language', style: AppTypography.body),
      subtitle: Text(currentLabel, style: AppTypography.footnote),
      trailing: const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      minVerticalPadding: AppSpacing.md,
      onTap: () => _showLanguagePicker(context, ref, currentLocale),
    );
  }

  void _showLanguagePicker(
      BuildContext context, WidgetRef ref, Locale? currentLocale) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
              child: Text('Select Language', style: AppTypography.title3),
            ),
            const Divider(),
            RadioGroup<String?>(
              groupValue: currentLocale?.languageCode,
              onChanged: (code) {
                if (code == null) {
                  ref.read(localeProvider.notifier).clearLocale();
                } else {
                  ref
                      .read(localeProvider.notifier)
                      .setLocale(Locale(code));
                }
                Navigator.pop(context);
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final lang in _languages)
                    RadioListTile<String?>(
                      value: lang.code,
                      title: Text(lang.label, style: AppTypography.body),
                      subtitle: lang.code != null && lang.native != lang.label
                          ? Text(lang.native, style: AppTypography.footnote)
                          : null,
                      activeColor: AppColors.primary,
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title, style: AppTypography.body),
      subtitle: Text(subtitle, style: AppTypography.footnote),
      trailing: trailing ??
          const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      minVerticalPadding: AppSpacing.md,
    );
  }
}
