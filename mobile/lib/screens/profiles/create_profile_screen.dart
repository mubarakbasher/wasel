import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/profiles_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class CreateProfileScreen extends ConsumerStatefulWidget {
  const CreateProfileScreen({super.key});

  @override
  ConsumerState<CreateProfileScreen> createState() =>
      _CreateProfileScreenState();
}

class _CreateProfileScreenState extends ConsumerState<CreateProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _groupNameController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _bandwidthUpController = TextEditingController();
  final _bandwidthDownController = TextEditingController();
  final _sessionTimeoutController = TextEditingController();
  final _totalTimeController = TextEditingController();
  final _totalDataController = TextEditingController();

  String _bandwidthUpUnit = 'M';
  String _bandwidthDownUnit = 'M';
  String _sessionTimeoutUnit = 'minutes';
  String _totalTimeUnit = 'hours';
  String _totalDataUnit = 'MB';

  @override
  void dispose() {
    _groupNameController.dispose();
    _displayNameController.dispose();
    _bandwidthUpController.dispose();
    _bandwidthDownController.dispose();
    _sessionTimeoutController.dispose();
    _totalTimeController.dispose();
    _totalDataController.dispose();
    super.dispose();
  }

  String? _buildBandwidth(String value, String unit) {
    if (value.trim().isEmpty) return null;
    return '${value.trim()}$unit';
  }

  int? _toSeconds(String value, String unit) {
    if (value.trim().isEmpty) return null;
    final num = int.tryParse(value.trim());
    if (num == null || num <= 0) return null;
    switch (unit) {
      case 'seconds':
        return num;
      case 'minutes':
        return num * 60;
      case 'hours':
        return num * 3600;
      case 'days':
        return num * 86400;
      default:
        return num;
    }
  }

  int? _toBytes(String value, String unit) {
    if (value.trim().isEmpty) return null;
    final num = int.tryParse(value.trim());
    if (num == null || num <= 0) return null;
    switch (unit) {
      case 'KB':
        return num * 1024;
      case 'MB':
        return num * 1024 * 1024;
      case 'GB':
        return num * 1024 * 1024 * 1024;
      default:
        return num;
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    ref.read(profilesProvider.notifier).clearError();

    final success = await ref.read(profilesProvider.notifier).createProfile(
          groupName: _groupNameController.text.trim(),
          displayName: _displayNameController.text.trim(),
          bandwidthUp:
              _buildBandwidth(_bandwidthUpController.text, _bandwidthUpUnit),
          bandwidthDown:
              _buildBandwidth(_bandwidthDownController.text, _bandwidthDownUnit),
          sessionTimeout:
              _toSeconds(_sessionTimeoutController.text, _sessionTimeoutUnit),
          totalTime: _toSeconds(_totalTimeController.text, _totalTimeUnit),
          totalData: _toBytes(_totalDataController.text, _totalDataUnit),
        );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile created successfully')),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(profilesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Create Profile')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            if (state.error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Text(
                  state.error!,
                  style: AppTypography.subhead.copyWith(color: AppColors.error),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
            // Basic Info Section
            Text('Basic Information', style: AppTypography.title3),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _groupNameController,
              decoration: const InputDecoration(
                labelText: 'Group Name *',
                prefixIcon: Icon(Icons.label),
                hintText: 'e.g. basic-1mbps',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Group name is required';
                }
                if (!RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(value.trim())) {
                  return 'Only letters, numbers, hyphens, and underscores';
                }
                if (value.trim().length > 100) {
                  return 'Must be at most 100 characters';
                }
                return null;
              },
              onChanged: (_) =>
                  ref.read(profilesProvider.notifier).clearError(),
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _displayNameController,
              decoration: const InputDecoration(
                labelText: 'Display Name *',
                prefixIcon: Icon(Icons.text_fields),
                hintText: 'e.g. Basic 1Mbps Plan',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Display name is required';
                }
                if (value.trim().length > 200) {
                  return 'Must be at most 200 characters';
                }
                return null;
              },
              onChanged: (_) =>
                  ref.read(profilesProvider.notifier).clearError(),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Bandwidth Section
            Text('Bandwidth Limits', style: AppTypography.title3),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Leave empty for unlimited bandwidth',
              style:
                  AppTypography.caption1.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            _buildBandwidthField(
              controller: _bandwidthUpController,
              label: 'Upload Speed',
              icon: Icons.upload,
              unit: _bandwidthUpUnit,
              onUnitChanged: (v) => setState(() => _bandwidthUpUnit = v!),
            ),
            const SizedBox(height: AppSpacing.lg),
            _buildBandwidthField(
              controller: _bandwidthDownController,
              label: 'Download Speed',
              icon: Icons.download,
              unit: _bandwidthDownUnit,
              onUnitChanged: (v) => setState(() => _bandwidthDownUnit = v!),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Time Limits Section
            Text('Time Limits', style: AppTypography.title3),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Leave empty for unlimited time',
              style:
                  AppTypography.caption1.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            _buildTimeField(
              controller: _sessionTimeoutController,
              label: 'Session Timeout',
              icon: Icons.timer,
              unit: _sessionTimeoutUnit,
              onUnitChanged: (v) => setState(() => _sessionTimeoutUnit = v!),
            ),
            const SizedBox(height: AppSpacing.lg),
            _buildTimeField(
              controller: _totalTimeController,
              label: 'Total Time',
              icon: Icons.schedule,
              unit: _totalTimeUnit,
              onUnitChanged: (v) => setState(() => _totalTimeUnit = v!),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Data Limit Section
            Text('Data Limit', style: AppTypography.title3),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Leave empty for unlimited data',
              style:
                  AppTypography.caption1.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            _buildDataField(
              controller: _totalDataController,
              label: 'Total Data',
              icon: Icons.data_usage,
              unit: _totalDataUnit,
              onUnitChanged: (v) => setState(() => _totalDataUnit = v!),
            ),
            const SizedBox(height: AppSpacing.xxxl),

            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: state.isLoading ? null : _submit,
                child: state.isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create Profile'),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
          ],
        ),
      ),
    );
  }

  Widget _buildBandwidthField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    required String unit,
    required ValueChanged<String?> onUnitChanged,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextFormField(
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: label,
              prefixIcon: Icon(icon),
              hintText: 'e.g. 2',
            ),
            validator: (value) {
              if (value != null && value.isNotEmpty) {
                final num = int.tryParse(value);
                if (num == null || num <= 0) {
                  return 'Must be a positive number';
                }
              }
              return null;
            },
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        SizedBox(
          width: 80,
          child: DropdownButtonFormField<String>(
            initialValue: unit,
            decoration: const InputDecoration(
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 12, vertical: 16),
            ),
            items: const [
              DropdownMenuItem(value: 'K', child: Text('Kbps')),
              DropdownMenuItem(value: 'M', child: Text('Mbps')),
            ],
            onChanged: onUnitChanged,
          ),
        ),
      ],
    );
  }

  Widget _buildTimeField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    required String unit,
    required ValueChanged<String?> onUnitChanged,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextFormField(
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: label,
              prefixIcon: Icon(icon),
              hintText: 'e.g. 60',
            ),
            validator: (value) {
              if (value != null && value.isNotEmpty) {
                final num = int.tryParse(value);
                if (num == null || num <= 0) {
                  return 'Must be a positive number';
                }
              }
              return null;
            },
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        SizedBox(
          width: 110,
          child: DropdownButtonFormField<String>(
            initialValue: unit,
            decoration: const InputDecoration(
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 12, vertical: 16),
            ),
            items: const [
              DropdownMenuItem(value: 'seconds', child: Text('Sec')),
              DropdownMenuItem(value: 'minutes', child: Text('Min')),
              DropdownMenuItem(value: 'hours', child: Text('Hours')),
              DropdownMenuItem(value: 'days', child: Text('Days')),
            ],
            onChanged: onUnitChanged,
          ),
        ),
      ],
    );
  }

  Widget _buildDataField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    required String unit,
    required ValueChanged<String?> onUnitChanged,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextFormField(
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: label,
              prefixIcon: Icon(icon),
              hintText: 'e.g. 500',
            ),
            validator: (value) {
              if (value != null && value.isNotEmpty) {
                final num = int.tryParse(value);
                if (num == null || num <= 0) {
                  return 'Must be a positive number';
                }
              }
              return null;
            },
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        SizedBox(
          width: 90,
          child: DropdownButtonFormField<String>(
            initialValue: unit,
            decoration: const InputDecoration(
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 12, vertical: 16),
            ),
            items: const [
              DropdownMenuItem(value: 'KB', child: Text('KB')),
              DropdownMenuItem(value: 'MB', child: Text('MB')),
              DropdownMenuItem(value: 'GB', child: Text('GB')),
            ],
            onChanged: onUnitChanged,
          ),
        ),
      ],
    );
  }
}
