import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/profiles_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  final String profileId;

  const EditProfileScreen({super.key, required this.profileId});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
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

  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(profilesProvider.notifier).loadProfile(widget.profileId));
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    _bandwidthUpController.dispose();
    _bandwidthDownController.dispose();
    _sessionTimeoutController.dispose();
    _totalTimeController.dispose();
    _totalDataController.dispose();
    super.dispose();
  }

  void _initializeFromProfile() {
    final profile = ref.read(profilesProvider).selectedProfile;
    if (profile == null || _initialized) return;
    _initialized = true;

    _displayNameController.text = profile.displayName;

    // Parse bandwidth (e.g. "2M" → value=2, unit=M)
    if (profile.bandwidthUp != null && profile.bandwidthUp!.isNotEmpty) {
      final parsed = _parseBandwidth(profile.bandwidthUp!);
      _bandwidthUpController.text = parsed.$1;
      _bandwidthUpUnit = parsed.$2;
    }
    if (profile.bandwidthDown != null && profile.bandwidthDown!.isNotEmpty) {
      final parsed = _parseBandwidth(profile.bandwidthDown!);
      _bandwidthDownController.text = parsed.$1;
      _bandwidthDownUnit = parsed.$2;
    }

    // Parse session timeout (seconds → best unit)
    if (profile.sessionTimeout != null && profile.sessionTimeout! > 0) {
      final parsed = _parseTime(profile.sessionTimeout!);
      _sessionTimeoutController.text = parsed.$1;
      _sessionTimeoutUnit = parsed.$2;
    }
    if (profile.totalTime != null && profile.totalTime! > 0) {
      final parsed = _parseTime(profile.totalTime!);
      _totalTimeController.text = parsed.$1;
      _totalTimeUnit = parsed.$2;
    }

    // Parse total data (bytes → best unit)
    if (profile.totalData != null && profile.totalData! > 0) {
      final parsed = _parseData(profile.totalData!);
      _totalDataController.text = parsed.$1;
      _totalDataUnit = parsed.$2;
    }

    setState(() {});
  }

  (String, String) _parseBandwidth(String bw) {
    final match = RegExp(r'^(\d+)([KM]?)$').firstMatch(bw);
    if (match != null) {
      return (match.group(1)!, match.group(2)!.isEmpty ? 'M' : match.group(2)!);
    }
    return (bw, 'M');
  }

  (String, String) _parseTime(int seconds) {
    if (seconds % 86400 == 0) return ('${seconds ~/ 86400}', 'days');
    if (seconds % 3600 == 0) return ('${seconds ~/ 3600}', 'hours');
    if (seconds % 60 == 0) return ('${seconds ~/ 60}', 'minutes');
    return ('$seconds', 'seconds');
  }

  (String, String) _parseData(int bytes) {
    if (bytes % (1024 * 1024 * 1024) == 0) {
      return ('${bytes ~/ (1024 * 1024 * 1024)}', 'GB');
    }
    if (bytes % (1024 * 1024) == 0) {
      return ('${bytes ~/ (1024 * 1024)}', 'MB');
    }
    if (bytes % 1024 == 0) return ('${bytes ~/ 1024}', 'KB');
    return ('$bytes', 'KB');
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

    final success = await ref.read(profilesProvider.notifier).updateProfile(
          widget.profileId,
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
        const SnackBar(content: Text('Profile updated successfully')),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(profilesProvider);
    final profile = state.selectedProfile;

    if (profile != null && !_initialized) {
      _initializeFromProfile();
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Edit Profile')),
      body: state.isLoading && profile == null
          ? const Center(child: CircularProgressIndicator())
          : profile == null
              ? Center(
                  child: Text('Profile not found',
                      style: AppTypography.body
                          .copyWith(color: AppColors.textSecondary)),
                )
              : Form(
                  key: _formKey,
                  child: ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      if (state.error != null) ...[
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.error.withValues(alpha: 0.1),
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusMd),
                          ),
                          child: Text(
                            state.error!,
                            style: AppTypography.subhead
                                .copyWith(color: AppColors.error),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                      ],
                      // Group name (read-only)
                      TextFormField(
                        initialValue: profile.groupName,
                        enabled: false,
                        decoration: const InputDecoration(
                          labelText: 'Group Name',
                          prefixIcon: Icon(Icons.label),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      TextFormField(
                        controller: _displayNameController,
                        decoration: const InputDecoration(
                          labelText: 'Display Name *',
                          prefixIcon: Icon(Icons.text_fields),
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

                      Text('Bandwidth Limits', style: AppTypography.title3),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Leave empty for unlimited bandwidth',
                        style: AppTypography.caption1
                            .copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      _buildBandwidthField(
                        controller: _bandwidthUpController,
                        label: 'Upload Speed',
                        icon: Icons.upload,
                        unit: _bandwidthUpUnit,
                        onUnitChanged: (v) =>
                            setState(() => _bandwidthUpUnit = v!),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _buildBandwidthField(
                        controller: _bandwidthDownController,
                        label: 'Download Speed',
                        icon: Icons.download,
                        unit: _bandwidthDownUnit,
                        onUnitChanged: (v) =>
                            setState(() => _bandwidthDownUnit = v!),
                      ),
                      const SizedBox(height: AppSpacing.xxl),

                      Text('Time Limits', style: AppTypography.title3),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Leave empty for unlimited time',
                        style: AppTypography.caption1
                            .copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      _buildTimeField(
                        controller: _sessionTimeoutController,
                        label: 'Session Timeout',
                        icon: Icons.timer,
                        unit: _sessionTimeoutUnit,
                        onUnitChanged: (v) =>
                            setState(() => _sessionTimeoutUnit = v!),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _buildTimeField(
                        controller: _totalTimeController,
                        label: 'Total Time',
                        icon: Icons.schedule,
                        unit: _totalTimeUnit,
                        onUnitChanged: (v) =>
                            setState(() => _totalTimeUnit = v!),
                      ),
                      const SizedBox(height: AppSpacing.xxl),

                      Text('Data Limit', style: AppTypography.title3),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Leave empty for unlimited data',
                        style: AppTypography.caption1
                            .copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      _buildDataField(
                        controller: _totalDataController,
                        label: 'Total Data',
                        icon: Icons.data_usage,
                        unit: _totalDataUnit,
                        onUnitChanged: (v) =>
                            setState(() => _totalDataUnit = v!),
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
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2),
                                )
                              : const Text('Save Changes'),
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
