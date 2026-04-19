import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/secure_window.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart' show Share;

import '../../i18n/app_localizations.dart';
import '../../providers/vouchers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class VoucherDetailScreen extends ConsumerStatefulWidget {
  final String routerId;
  final String voucherId;

  const VoucherDetailScreen({
    super.key,
    required this.routerId,
    required this.voucherId,
  });

  @override
  ConsumerState<VoucherDetailScreen> createState() =>
      _VoucherDetailScreenState();
}

class _VoucherDetailScreenState extends ConsumerState<VoucherDetailScreen>
    with WidgetsBindingObserver {
  Timer? _refreshTimer;

  // iOS blur overlay: shown when app enters inactive state.
  bool _obscured = false;

  // Clipboard auto-clear timer.
  Timer? _clipboardClearTimer;
  String? _lastCopiedValue;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Android: prevent screenshots / screen recording.
    if (Platform.isAndroid) {
      SecureWindow.enable();
    }
    Future.microtask(() {
      ref
          .read(vouchersProvider.notifier)
          .loadVoucher(widget.routerId, widget.voucherId);
    });
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      ref.read(vouchersProvider.notifier).loadVoucher(widget.routerId, widget.voucherId);
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _clipboardClearTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (Platform.isAndroid) {
      SecureWindow.disable();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // iOS blur overlay logic.
    if (Platform.isIOS) {
      if (state == AppLifecycleState.inactive ||
          state == AppLifecycleState.paused) {
        if (mounted) setState(() => _obscured = true);
      } else if (state == AppLifecycleState.resumed) {
        if (mounted) setState(() => _obscured = false);
      }
    }

    // Existing data-refresh logic.
    if (state == AppLifecycleState.resumed) {
      ref.read(vouchersProvider.notifier).loadVoucher(widget.routerId, widget.voucherId);
      _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
        ref.read(vouchersProvider.notifier).loadVoucher(widget.routerId, widget.voucherId);
      });
    } else if (state == AppLifecycleState.paused) {
      _refreshTimer?.cancel();
    }
  }

  /// Copy [text] to the clipboard and schedule auto-clear after 30 seconds.
  Future<void> _copyWithAutoClear(String text) async {
    _lastCopiedValue = text;
    await Clipboard.setData(ClipboardData(text: text));
    _clipboardClearTimer?.cancel();
    _clipboardClearTimer = Timer(const Duration(seconds: 30), () async {
      final current = await Clipboard.getData('text/plain');
      if (current?.text == _lastCopiedValue) {
        await Clipboard.setData(const ClipboardData(text: ''));
      }
    });
  }

  Future<void> _toggleStatus() async {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    final isCurrentlyEnabled = !voucher.isDisabled;
    final titleKey = isCurrentlyEnabled ? 'vouchers.disableVoucherTitle' : 'vouchers.enableVoucherTitle';
    final bodyKey = isCurrentlyEnabled ? 'vouchers.disableVoucherBody' : 'vouchers.enableVoucherBody';
    final actionKey = isCurrentlyEnabled ? 'vouchers.disable' : 'vouchers.enable';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr(titleKey)),
        content: Text(context.tr(bodyKey)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr(actionKey)),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    await ref
        .read(vouchersProvider.notifier)
        .toggleVoucherStatus(widget.routerId, voucher);
    // Reload to get fresh data
    if (mounted) {
      ref
          .read(vouchersProvider.notifier)
          .loadVoucher(widget.routerId, widget.voucherId);
    }
  }

  Future<void> _deleteVoucher() async {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('vouchers.deleteVoucherTitle')),
        content: Text(context.tr('vouchers.deleteVoucherBody')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: Text(context.tr('common.delete')),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final success = await ref
        .read(vouchersProvider.notifier)
        .deleteVoucher(widget.routerId, voucher.id);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('vouchers.deletedSuccessfully'))),
      );
      context.pop();
    }
  }

  void _shareVoucher() {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    final wifiLabel = context.tr('vouchers.wifiVoucher');
    final codeLabel = context.tr('vouchers.voucherCode');
    final planLabel = context.tr('vouchers.plan');
    final text = StringBuffer()
      ..writeln(wifiLabel)
      ..writeln('─────────────')
      ..writeln('$codeLabel: ${voucher.username}')
      ..writeln('$planLabel: ${voucher.limitDisplayText}')
      ..writeln('─────────────');
    if (voucher.expiration != null) {
      text.writeln('${context.tr('vouchers.expires')}: ${voucher.expiration}');
    }

    Share.share(text.toString());
  }

  Future<void> _copyCredentials() async {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    await _copyWithAutoClear(voucher.username);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('vouchers.credentialsCopied'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(vouchersProvider);
    final voucher = state.selectedVoucher;

    return Stack(
      children: [
        Scaffold(
          appBar: AppBar(
            title: Text(context.tr('vouchers.voucherDetails')),
            actions: [
              if (voucher != null) ...[
                IconButton(
                  icon: const Icon(Icons.share),
                  onPressed: _shareVoucher,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: _deleteVoucher,
                ),
              ],
            ],
          ),
          body: state.isLoading && voucher == null
              ? const Center(child: CircularProgressIndicator())
              : voucher == null
                  ? Center(
                      child: Text(context.tr('vouchers.voucherNotFound'),
                          style: AppTypography.body
                              .copyWith(color: AppColors.textSecondary)),
                    )
                  : RefreshIndicator(
                      onRefresh: () => ref
                          .read(vouchersProvider.notifier)
                          .loadVoucher(widget.routerId, widget.voucherId),
                      child: ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      _buildCredentialsCard(voucher),
                      const SizedBox(height: AppSpacing.lg),
                      if (voucher.usagePercent != null)
                        ...[
                          _buildUsageCard(voucher),
                          const SizedBox(height: AppSpacing.lg),
                        ],
                      _buildInfoCard(voucher),
                      const SizedBox(height: AppSpacing.lg),
                      _buildActionsCard(voucher),
                    ],
                  ),
                ),
        ),
        // iOS: blur screen content in the app-switcher / inactive state.
        if (_obscured)
          Positioned.fill(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(color: Colors.black.withValues(alpha: 0.4)),
            ),
          ),
      ],
    );
  }

  Widget _buildCredentialsCard(dynamic voucher) {
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
              Text(context.tr('vouchers.credentials'), style: AppTypography.title3),
              const Spacer(),
              _StatusBadge(status: voucher.status),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          // Voucher Code
          Text(context.tr('vouchers.voucherCode'),
              style: AppTypography.caption1
                  .copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: [
              Expanded(
                child: Text(
                  voucher.username,
                  style: AppTypography.title2.copyWith(
                    fontFamily: 'monospace',
                    letterSpacing: 1.2,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.copy, size: 20),
                onPressed: () async {
                  await _copyWithAutoClear(voucher.username);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                          content: Text(context.tr('vouchers.codeCopied'))),
                    );
                  }
                },
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _copyCredentials,
              icon: const Icon(Icons.copy_all, size: 18),
              label: Text(context.tr('vouchers.copyAll')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUsageCard(dynamic voucher) {
    final percent = voucher.usagePercent as double;
    final usageText = voucher.usageDisplayText as String? ?? '';
    final isExceeded = percent >= 1.0;
    final progressColor = isExceeded
        ? AppColors.error
        : percent > 0.8
            ? AppColors.warning
            : AppColors.primary;

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
              Icon(
                voucher.limitType == 'time' ? Icons.access_time : Icons.data_usage,
                size: 18,
                color: AppColors.textSecondary,
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(context.tr('vouchers.usage'), style: AppTypography.title3),
              const Spacer(),
              Text(
                '${(percent * 100).toStringAsFixed(0)}%',
                style: AppTypography.subhead.copyWith(
                  fontWeight: FontWeight.w600,
                  color: progressColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: LinearProgressIndicator(
              value: percent,
              minHeight: 8,
              backgroundColor: AppColors.border,
              valueColor: AlwaysStoppedAnimation<Color>(progressColor),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            usageText,
            style: AppTypography.caption1.copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoCard(dynamic voucher) {
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
          Text(context.tr('vouchers.details'), style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
            label: context.tr('vouchers.limit'),
            value: voucher.limitDisplayText,
            icon: Icons.layers,
          ),
          if (voucher.price != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('vouchers.price'),
              value: voucher.price!.toStringAsFixed(2),
              icon: Icons.attach_money,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('vouchers.status'),
            value: _capitalizeStatus(voucher.status),
            icon: Icons.circle,
            valueColor: _statusColor(voucher.status),
          ),
          if (voucher.expiration != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('vouchers.expires'),
              value: voucher.expiration!,
              icon: Icons.timer,
            ),
          ],
          if (voucher.simultaneousUse != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('vouchers.simultaneousUse'),
              value: '${voucher.simultaneousUse}',
              icon: Icons.devices,
            ),
          ],
          if (voucher.comment != null && voucher.comment!.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('vouchers.comment'),
              value: voucher.comment!,
              icon: Icons.comment,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('vouchers.created'),
            value: _formatDateTime(voucher.createdAt),
            icon: Icons.calendar_today,
          ),
        ],
      ),
    );
  }

  Widget _buildActionsCard(dynamic voucher) {
    return Column(
      children: [
        // Enable/Disable toggle
        if (voucher.status != 'expired')
          SizedBox(
            height: 48,
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _toggleStatus,
              icon: Icon(
                voucher.isDisabled ? Icons.check_circle : Icons.block,
                size: 20,
              ),
              label: Text(voucher.isDisabled
                  ? context.tr('vouchers.enableVoucher')
                  : context.tr('vouchers.disableVoucher')),
              style: !voucher.isDisabled
                  ? ElevatedButton.styleFrom(
                      backgroundColor: AppColors.warning,
                      foregroundColor: Colors.white,
                    )
                  : null,
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        // Share
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _shareVoucher,
            icon: const Icon(Icons.share, size: 20),
            label: Text(context.tr('vouchers.shareVoucher')),
          ),
        ),
      ],
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'unused':
        return AppColors.primary;
      case 'active':
        return AppColors.voucherActive;
      case 'disabled':
        return AppColors.voucherDisabled;
      case 'expired':
        return AppColors.voucherExpired;
      case 'used':
        return AppColors.voucherUsed;
      default:
        return AppColors.textSecondary;
    }
  }

  String _capitalizeStatus(String status) {
    if (status.isEmpty) return status;
    return status[0].toUpperCase() + status.substring(1);
  }

  String _formatDateTime(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} '
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: _statusColor(status).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Text(
        _capitalizeStatus(status),
        style: AppTypography.caption1.copyWith(
          color: _statusColor(status),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'unused':
        return AppColors.primary;
      case 'active':
        return AppColors.voucherActive;
      case 'disabled':
        return AppColors.voucherDisabled;
      case 'expired':
        return AppColors.voucherExpired;
      case 'used':
        return AppColors.voucherUsed;
      default:
        return AppColors.textSecondary;
    }
  }

  String _capitalizeStatus(String status) {
    if (status.isEmpty) return status;
    return status[0].toUpperCase() + status.substring(1);
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? valueColor;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.icon,
    this.valueColor,
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
            style: AppTypography.subhead.copyWith(
              fontWeight: FontWeight.w600,
              color: valueColor,
            ),
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
