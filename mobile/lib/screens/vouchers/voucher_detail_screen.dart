import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart' show Share;

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

class _VoucherDetailScreenState extends ConsumerState<VoucherDetailScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref
          .read(vouchersProvider.notifier)
          .loadVoucher(widget.routerId, widget.voucherId);
    });
  }

  Future<void> _toggleStatus() async {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    final newStatus = voucher.isActive ? 'Disable' : 'Enable';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$newStatus Voucher?'),
        content: Text(
          voucher.isActive
              ? 'This will prevent the voucher from being used for authentication.'
              : 'This will re-enable the voucher for authentication.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(newStatus),
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
        title: const Text('Delete Voucher?'),
        content: const Text(
          'Are you sure you want to delete this voucher? Active sessions will be disconnected. This action cannot be undone.',
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

    final success = await ref
        .read(vouchersProvider.notifier)
        .deleteVoucher(widget.routerId, voucher.id);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Voucher deleted successfully')),
      );
      context.pop();
    }
  }

  void _shareVoucher() {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    final text = StringBuffer()
      ..writeln('WiFi Voucher')
      ..writeln('─────────────')
      ..writeln('Code: ${voucher.username}')
      ..writeln('Plan: ${voucher.limitDisplayText}')
      ..writeln('─────────────');
    if (voucher.expiration != null) {
      text.writeln('Valid until: ${voucher.expiration}');
    }

    Share.share(text.toString());
  }

  void _copyCredentials() {
    final voucher = ref.read(vouchersProvider).selectedVoucher;
    if (voucher == null) return;

    Clipboard.setData(ClipboardData(text: voucher.username));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Credentials copied to clipboard')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(vouchersProvider);
    final voucher = state.selectedVoucher;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Voucher Details'),
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
                  child: Text('Voucher not found',
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
                      _buildInfoCard(voucher),
                      const SizedBox(height: AppSpacing.lg),
                      _buildActionsCard(voucher),
                    ],
                  ),
                ),
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
              Text('Credentials', style: AppTypography.title3),
              const Spacer(),
              _StatusBadge(status: voucher.status),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          // Voucher Code
          Text('Voucher Code',
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
                onPressed: () {
                  Clipboard.setData(
                      ClipboardData(text: voucher.username));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text('Code copied')),
                  );
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
              label: const Text('Copy All'),
            ),
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
          Text('Details', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
            label: 'Limit',
            value: voucher.limitDisplayText,
            icon: Icons.layers,
          ),
          if (voucher.price != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: 'Price',
              value: voucher.price!.toStringAsFixed(2),
              icon: Icons.attach_money,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Status',
            value: _capitalizeStatus(voucher.status),
            icon: Icons.circle,
            valueColor: _statusColor(voucher.status),
          ),
          if (voucher.expiration != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: 'Expires',
              value: voucher.expiration!,
              icon: Icons.timer,
            ),
          ],
          if (voucher.simultaneousUse != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: 'Simultaneous Use',
              value: '${voucher.simultaneousUse}',
              icon: Icons.devices,
            ),
          ],
          if (voucher.comment != null && voucher.comment!.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: 'Comment',
              value: voucher.comment!,
              icon: Icons.comment,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: 'Created',
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
        if (voucher.status == 'active' || voucher.status == 'disabled')
          SizedBox(
            height: 48,
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _toggleStatus,
              icon: Icon(
                voucher.isActive ? Icons.block : Icons.check_circle,
                size: 20,
              ),
              label: Text(voucher.isActive ? 'Disable Voucher' : 'Enable Voucher'),
              style: voucher.isActive
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
            label: const Text('Share Voucher'),
          ),
        ),
      ],
    );
  }

  Color _statusColor(String status) {
    switch (status) {
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
