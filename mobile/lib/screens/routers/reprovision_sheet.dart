import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/router_health.dart';
import '../../providers/provision_poll_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

// Probe order and labels reused from add_router_screen — kept here to avoid a
// circular import. Both lists are small value constants so duplication is fine.
const _kProbeLabels = <String, String>{
  'wgHandshakeRecent': 'WireGuard handshake',
  'routerOsApiReachable': 'RouterOS API reachable',
  'radiusClientConfigured': 'RADIUS client configured',
  'hotspotUsesRadius': 'Hotspot profile uses RADIUS',
  'firewallAllowsRadius': 'Firewall rules',
  'hotspotServerBound': 'Hotspot server bound',
  'synthRadiusAuth': 'Voucher auth works',
};

const _kProbeOrder = [
  'wgHandshakeRecent',
  'routerOsApiReachable',
  'radiusClientConfigured',
  'hotspotUsesRadius',
  'firewallAllowsRadius',
  'hotspotServerBound',
  'synthRadiusAuth',
];

class ReprovisionSheet extends ConsumerWidget {
  final String routerId;

  const ReprovisionSheet({super.key, required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pollState = ref.watch(provisionPollProvider(routerId));

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      builder: (context, scrollController) => Column(
        children: [
          _SheetHandle(),
          Expanded(
            child: ListView(
              controller: scrollController,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              children: [
                _SheetHeader(pollState: pollState, routerId: routerId),
                const SizedBox(height: AppSpacing.sm),
                const Divider(),
                const SizedBox(height: AppSpacing.sm),
                if (pollState.report?.needsHotspotConfirmation == true)
                  _SheetHotspotCard(
                      routerId: routerId, pollState: pollState),
                _SheetProbeList(report: pollState.report),
                if (pollState.report?.provisionError?.isNotEmpty == true)
                  _SheetErrorExpander(
                      errors: pollState.report!.provisionError!),
                if (pollState.isTimedOut)
                  _SheetTimeoutBanner(routerId: routerId),
                if (pollState.error != null && !pollState.isTimedOut)
                  _SheetErrorBanner(message: pollState.error!),
                const SizedBox(height: AppSpacing.xxl),
              ],
            ),
          ),
          _SheetFooter(pollState: pollState, routerId: routerId),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

class _SheetHandle extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Center(
        child: Container(
          width: 40,
          height: 4,
          decoration: BoxDecoration(
            color: AppColors.divider,
            borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Header row: title + status chip
// ---------------------------------------------------------------------------

class _SheetHeader extends StatelessWidget {
  final ProvisionPollState pollState;
  final String routerId;

  const _SheetHeader({required this.pollState, required this.routerId});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text('Re-apply config', style: AppTypography.title3),
        ),
        _SheetStatusChip(pollState: pollState),
      ],
    );
  }
}

class _SheetStatusChip extends StatelessWidget {
  final ProvisionPollState pollState;

  const _SheetStatusChip({required this.pollState});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _chipData();
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(label,
          style: AppTypography.caption1
              .copyWith(color: color, fontWeight: FontWeight.w600)),
    );
  }

  (String, Color) _chipData() {
    if (pollState.isTimedOut) return ('Timed out', AppColors.error);
    final status = pollState.report?.provisionStatus;
    final overall = pollState.report?.overall;
    if (status == null) return ('Waiting', AppColors.textTertiary);
    if (status == ProvisionStatus.succeeded &&
        overall == OverallHealth.healthy) {
      return ('Done', AppColors.success);
    }
    if (status == ProvisionStatus.partial) {
      final n = pollState.report?.provisionError?.length ?? 0;
      return ('Partial — $n error${n == 1 ? '' : 's'}', AppColors.warning);
    }
    if (status == ProvisionStatus.failed) return ('Failed', AppColors.error);
    return ('Configuring...', AppColors.primary);
  }
}

// ---------------------------------------------------------------------------
// Probe list
// ---------------------------------------------------------------------------

class _SheetProbeList extends StatelessWidget {
  final RouterHealthReport? report;

  const _SheetProbeList({this.report});

  @override
  Widget build(BuildContext context) {
    final probeMap = <String, ProbeResult>{};
    if (report != null) {
      for (final p in report!.probes) {
        probeMap[p.id] = p;
      }
    }

    return Column(
      children: _kProbeOrder.map((probeId) {
        final probe = probeMap[probeId];
        final label = _kProbeLabels[probeId] ?? probe?.label ?? probeId;
        return _SheetProbeRow(label: label, probe: probe);
      }).toList(),
    );
  }
}

class _SheetProbeRow extends StatelessWidget {
  final String label;
  final ProbeResult? probe;

  const _SheetProbeRow({required this.label, this.probe});

  @override
  Widget build(BuildContext context) {
    final status = probe?.status;

    Widget leading;
    Color labelColor = AppColors.textPrimary;

    if (status == ProbeStatus.pass) {
      leading =
          const Icon(Icons.check_circle, color: AppColors.success, size: 20);
    } else if (status == ProbeStatus.fail) {
      leading = const Icon(Icons.cancel, color: AppColors.error, size: 20);
      labelColor = AppColors.error;
    } else {
      if (probe == null) {
        leading = const SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
        labelColor = AppColors.textSecondary;
      } else {
        leading = const Icon(Icons.remove_circle_outline,
            color: AppColors.textTertiary, size: 20);
        labelColor = AppColors.textTertiary;
      }
    }

    if (status == ProbeStatus.fail &&
        (probe!.remediation != null || probe!.setupStep != null)) {
      return _SheetFailRow(label: label, probe: probe!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          leading,
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(label,
                style: AppTypography.subhead.copyWith(color: labelColor)),
          ),
        ],
      ),
    );
  }
}

class _SheetFailRow extends StatelessWidget {
  final String label;
  final ProbeResult probe;

  const _SheetFailRow({required this.label, required this.probe});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.cancel, color: AppColors.error, size: 20),
      title: Text(label,
          style: AppTypography.subhead.copyWith(color: AppColors.error)),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(
          left: AppSpacing.xxl + AppSpacing.sm, bottom: AppSpacing.sm),
      children: [
        if (probe.remediation != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(probe.remediation!,
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textSecondary)),
          ),
        if (probe.setupStep != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Setup step ${probe.setupStep}',
              style: AppTypography.caption1
                  .copyWith(color: AppColors.primary),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Hotspot interface confirmation (mirrored from add_router_screen)
// ---------------------------------------------------------------------------

class _SheetHotspotCard extends ConsumerStatefulWidget {
  final String routerId;
  final ProvisionPollState pollState;

  const _SheetHotspotCard(
      {required this.routerId, required this.pollState});

  @override
  ConsumerState<_SheetHotspotCard> createState() =>
      _SheetHotspotCardState();
}

class _SheetHotspotCardState extends ConsumerState<_SheetHotspotCard> {
  String? _selectedInterface;

  static const _kAllowedTypes = {'ether', 'bridge', 'wlan', 'vlan'};

  List<RouterInterface> get _filteredInterfaces {
    final report = widget.pollState.report;
    if (report == null) return const [];
    return report.availableInterfaces
        .where((i) => _kAllowedTypes.contains(i.type))
        .toList();
  }

  @override
  void didUpdateWidget(_SheetHotspotCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_selectedInterface == null) {
      final suggested =
          widget.pollState.report?.suggestedHotspotInterface;
      if (suggested != null) _selectedInterface = suggested;
    }
  }

  @override
  Widget build(BuildContext context) {
    final interfaces = _filteredInterfaces;
    final isConfirming = widget.pollState.isConfirmingInterface;
    final effectiveSelection =
        interfaces.any((i) => i.name == _selectedInterface)
            ? _selectedInterface
            : (interfaces.isNotEmpty ? interfaces.first.name : null);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border:
            Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.wifi, color: AppColors.primary, size: 18),
              const SizedBox(width: AppSpacing.xs),
              Text('Choose the hotspot interface',
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            "Wasel couldn't find an existing hotspot on your router. "
            'Pick the LAN interface where Wi-Fi clients connect.',
            style: AppTypography.caption1
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          if (interfaces.isEmpty)
            Text('No interfaces available',
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textTertiary))
          else
            DropdownButtonFormField<String>(
              initialValue: effectiveSelection,
              decoration: const InputDecoration(
                contentPadding: EdgeInsets.symmetric(
                    horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                isDense: true,
              ),
              items: interfaces
                  .map((i) => DropdownMenuItem(
                        value: i.name,
                        child: Text('${i.name} (${i.type})'),
                      ))
                  .toList(),
              onChanged: isConfirming
                  ? null
                  : (v) => setState(() => _selectedInterface = v),
            ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 40,
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (isConfirming || effectiveSelection == null)
                  ? null
                  : () => ref
                      .read(provisionPollProvider(widget.routerId).notifier)
                      .confirmInterface(effectiveSelection),
              child: isConfirming
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Confirm'),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Step error expander
// ---------------------------------------------------------------------------

class _SheetErrorExpander extends StatelessWidget {
  final List<ProvisionStepError> errors;

  const _SheetErrorExpander({required this.errors});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.warning_amber_rounded,
          color: AppColors.warning, size: 20),
      title: Text('Show errors (${errors.length})',
          style: AppTypography.caption1
              .copyWith(color: AppColors.warning)),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: AppSpacing.sm),
      children: errors
          .map((e) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      margin: const EdgeInsets.only(top: 5),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.error,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text('${e.step}: ${e.error}',
                          style: AppTypography.caption1
                              .copyWith(color: AppColors.textSecondary)),
                    ),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

// ---------------------------------------------------------------------------
// Timeout banner
// ---------------------------------------------------------------------------

class _SheetTimeoutBanner extends ConsumerWidget {
  final String routerId;

  const _SheetTimeoutBanner({required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.only(top: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.timer_off, color: AppColors.error, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text('Auto-configuration timed out after 10 minutes.',
                style:
                    AppTypography.caption1.copyWith(color: AppColors.error)),
          ),
          const SizedBox(width: AppSpacing.sm),
          TextButton(
            onPressed: () => ref
                .read(provisionPollProvider(routerId).notifier)
                .reprovision(),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.error,
              padding:
                  const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Generic error banner
// ---------------------------------------------------------------------------

class _SheetErrorBanner extends StatelessWidget {
  final String message;

  const _SheetErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.warning_amber_rounded,
              color: AppColors.warning, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(message,
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textSecondary)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Footer — "Reprovision" button + close
// ---------------------------------------------------------------------------

class _SheetFooter extends ConsumerWidget {
  final ProvisionPollState pollState;
  final String routerId;

  const _SheetFooter(
      {required this.pollState, required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.lg),
        child: Row(
          children: [
            Expanded(
              child: SizedBox(
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: () => ref
                      .read(provisionPollProvider(routerId).notifier)
                      .reprovision(),
                  icon: const Icon(Icons.sync),
                  label: const Text('Re-apply now'),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            SizedBox(
              height: 48,
              child: OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Close'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
