import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/profiles_provider.dart';
import '../../providers/vouchers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class BulkCreateScreen extends ConsumerStatefulWidget {
  final String routerId;

  const BulkCreateScreen({super.key, required this.routerId});

  @override
  ConsumerState<BulkCreateScreen> createState() => _BulkCreateScreenState();
}

class _BulkCreateScreenState extends ConsumerState<BulkCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _countController = TextEditingController(text: '10');
  final _prefixController = TextEditingController();
  final _commentController = TextEditingController();
  String? _selectedProfileId;
  int _usernameLength = 8;
  int _passwordLength = 8;
  int _simultaneousUse = 1;
  bool _useExpiration = false;
  DateTime _expirationDate = DateTime.now().add(const Duration(days: 30));

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(profilesProvider.notifier).loadProfiles());
  }

  @override
  void dispose() {
    _countController.dispose();
    _prefixController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedProfileId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a profile')),
      );
      return;
    }

    final count = int.tryParse(_countController.text) ?? 0;
    if (count < 1 || count > 100) return;

    final success = await ref.read(vouchersProvider.notifier).createVouchersBulk(
          routerId: widget.routerId,
          profileId: _selectedProfileId!,
          count: count,
          usernamePrefix: _prefixController.text.isEmpty
              ? null
              : _prefixController.text,
          usernameLength: _usernameLength,
          passwordLength: _passwordLength,
          comment: _commentController.text.isEmpty
              ? null
              : _commentController.text,
          expiration:
              _useExpiration ? _expirationDate.toUtc().toIso8601String() : null,
          simultaneousUse: _simultaneousUse > 1 ? _simultaneousUse : null,
        );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$count vouchers created successfully')),
      );
      context.pop();
    }
  }

  Future<void> _pickExpirationDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _expirationDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date != null) {
      setState(() => _expirationDate = date);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profilesState = ref.watch(profilesProvider);
    final vouchersState = ref.watch(vouchersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Bulk Create Vouchers')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            // Profile selector
            Text('Profile *', style: AppTypography.subhead.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.xs),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                border: Border.all(color: AppColors.border),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedProfileId,
                  hint: const Text('Select a profile'),
                  isExpanded: true,
                  items: profilesState.profiles.map((profile) {
                    return DropdownMenuItem(
                      value: profile.id,
                      child: Text(profile.displayName),
                    );
                  }).toList(),
                  onChanged: (value) =>
                      setState(() => _selectedProfileId = value),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),

            // Quantity
            TextFormField(
              controller: _countController,
              decoration: const InputDecoration(
                labelText: 'Quantity *',
                hintText: '1-100',
                prefixIcon: Icon(Icons.numbers),
              ),
              keyboardType: TextInputType.number,
              validator: (v) {
                if (v == null || v.isEmpty) return 'Required';
                final count = int.tryParse(v);
                if (count == null) return 'Must be a number';
                if (count < 1) return 'Min 1';
                if (count > 100) return 'Max 100';
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),

            // Username prefix
            TextFormField(
              controller: _prefixController,
              decoration: const InputDecoration(
                labelText: 'Username Prefix (optional)',
                hintText: 'e.g., WIFI-',
                prefixIcon: Icon(Icons.text_fields),
              ),
              validator: (v) {
                if (v != null && v.isNotEmpty) {
                  if (!RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(v)) {
                    return 'Only letters, numbers, hyphens, underscores';
                  }
                  if (v.length > 50) return 'Max 50 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),

            // Username length + password length
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Username Length',
                          style: AppTypography.caption1
                              .copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: AppSpacing.xs),
                      _LengthSelector(
                        value: _usernameLength,
                        min: 4,
                        max: 16,
                        onChanged: (v) =>
                            setState(() => _usernameLength = v),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.lg),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Password Length',
                          style: AppTypography.caption1
                              .copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: AppSpacing.xs),
                      _LengthSelector(
                        value: _passwordLength,
                        min: 4,
                        max: 16,
                        onChanged: (v) =>
                            setState(() => _passwordLength = v),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            // Comment
            TextFormField(
              controller: _commentController,
              decoration: const InputDecoration(
                labelText: 'Comment (optional)',
                hintText: 'Applied to all vouchers',
                prefixIcon: Icon(Icons.comment_outlined),
              ),
              maxLength: 255,
            ),
            const SizedBox(height: AppSpacing.lg),

            // Simultaneous Use
            Text('Simultaneous Use',
                style: AppTypography.subhead
                    .copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                IconButton(
                  onPressed: _simultaneousUse > 1
                      ? () => setState(() => _simultaneousUse--)
                      : null,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                Text('$_simultaneousUse', style: AppTypography.title3),
                IconButton(
                  onPressed: _simultaneousUse < 10
                      ? () => setState(() => _simultaneousUse++)
                      : null,
                  icon: const Icon(Icons.add_circle_outline),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'device${_simultaneousUse > 1 ? 's' : ''} at a time',
                  style: AppTypography.footnote,
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            // Expiration
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Set Expiration',
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600)),
              value: _useExpiration,
              onChanged: (v) => setState(() => _useExpiration = v),
            ),
            if (_useExpiration) ...[
              GestureDetector(
                onTap: _pickExpirationDate,
                child: Container(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius:
                        BorderRadius.circular(AppSpacing.radiusMd),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.calendar_today,
                          size: 18, color: AppColors.textSecondary),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        '${_expirationDate.year}-${_expirationDate.month.toString().padLeft(2, '0')}-${_expirationDate.day.toString().padLeft(2, '0')}',
                        style: AppTypography.body,
                      ),
                      const Spacer(),
                      const Icon(Icons.edit,
                          size: 18, color: AppColors.textSecondary),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.xxl),

            // Error
            if (vouchersState.error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.errorLight,
                  borderRadius:
                      BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Text(
                  vouchersState.error!,
                  style: AppTypography.footnote
                      .copyWith(color: AppColors.error),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],

            // Submit
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton(
                onPressed: vouchersState.isLoading ? null : _submit,
                child: vouchersState.isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        'Create ${_countController.text} Vouchers',
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LengthSelector extends StatelessWidget {
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  const _LengthSelector({
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: value > min ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove, size: 18),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          ),
          Text('$value', style: AppTypography.title3),
          IconButton(
            onPressed: value < max ? () => onChanged(value + 1) : null,
            icon: const Icon(Icons.add, size: 18),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          ),
        ],
      ),
    );
  }
}
