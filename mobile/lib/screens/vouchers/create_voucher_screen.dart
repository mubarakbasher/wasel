import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/profiles_provider.dart';
import '../../providers/vouchers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class CreateVoucherScreen extends ConsumerStatefulWidget {
  final String routerId;

  const CreateVoucherScreen({super.key, required this.routerId});

  @override
  ConsumerState<CreateVoucherScreen> createState() =>
      _CreateVoucherScreenState();
}

class _CreateVoucherScreenState extends ConsumerState<CreateVoucherScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _commentController = TextEditingController();
  String? _selectedProfileId;
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
    _usernameController.dispose();
    _passwordController.dispose();
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

    final success = await ref.read(vouchersProvider.notifier).createVoucher(
          routerId: widget.routerId,
          profileId: _selectedProfileId!,
          username: _usernameController.text.isEmpty
              ? null
              : _usernameController.text,
          password: _passwordController.text.isEmpty
              ? null
              : _passwordController.text,
          comment: _commentController.text.isEmpty
              ? null
              : _commentController.text,
          expiration:
              _useExpiration ? _expirationDate.toUtc().toIso8601String() : null,
          simultaneousUse: _simultaneousUse > 1 ? _simultaneousUse : null,
        );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Voucher created successfully')),
      );
      final voucher = ref.read(vouchersProvider).selectedVoucher;
      if (voucher != null) {
        context.pushReplacement(
          '/vouchers/detail',
          extra: {'routerId': widget.routerId, 'voucherId': voucher.id},
        );
      } else {
        context.pop();
      }
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
      appBar: AppBar(title: const Text('Create Voucher')),
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

            // Username (optional)
            TextFormField(
              controller: _usernameController,
              decoration: const InputDecoration(
                labelText: 'Username (optional)',
                hintText: 'Auto-generated if blank',
                prefixIcon: Icon(Icons.person_outline),
              ),
              validator: (v) {
                if (v != null && v.isNotEmpty) {
                  if (v.length < 3) return 'Min 3 characters';
                  if (v.length > 64) return 'Max 64 characters';
                  if (!RegExp(r'^[a-zA-Z0-9_-]+$').hasMatch(v)) {
                    return 'Only letters, numbers, hyphens, underscores';
                  }
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),

            // Password (optional)
            TextFormField(
              controller: _passwordController,
              decoration: const InputDecoration(
                labelText: 'Password (optional)',
                hintText: 'Auto-generated if blank',
                prefixIcon: Icon(Icons.lock_outline),
              ),
              validator: (v) {
                if (v != null && v.isNotEmpty) {
                  if (v.length < 4) return 'Min 4 characters';
                  if (v.length > 64) return 'Max 64 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),

            // Comment
            TextFormField(
              controller: _commentController,
              decoration: const InputDecoration(
                labelText: 'Comment (optional)',
                hintText: 'e.g., Guest room 1',
                prefixIcon: Icon(Icons.comment_outlined),
              ),
              maxLength: 255,
            ),
            const SizedBox(height: AppSpacing.lg),

            // Simultaneous Use
            Text('Simultaneous Use', style: AppTypography.subhead.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                IconButton(
                  onPressed: _simultaneousUse > 1
                      ? () => setState(() => _simultaneousUse--)
                      : null,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                Text(
                  '$_simultaneousUse',
                  style: AppTypography.title3,
                ),
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
                    : const Text('Create Voucher'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
