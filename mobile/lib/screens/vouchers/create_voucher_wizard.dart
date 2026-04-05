import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/vouchers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class CreateVoucherWizard extends ConsumerStatefulWidget {
  final String routerId;

  const CreateVoucherWizard({super.key, required this.routerId});

  @override
  ConsumerState<CreateVoucherWizard> createState() =>
      _CreateVoucherWizardState();
}

class _CreateVoucherWizardState extends ConsumerState<CreateVoucherWizard> {
  static const _stepLabels = ['Limit', 'Validity', 'Count & Price'];

  final _pageController = PageController();
  final _step1FormKey = GlobalKey<FormState>();
  final _step3FormKey = GlobalKey<FormState>();

  final _limitValueController = TextEditingController();
  final _countController = TextEditingController(text: '1');
  final _priceController = TextEditingController();

  int _currentStep = 0;
  bool _isSubmitting = false;

  // Step 1: Limit
  String _limitType = 'time'; // 'time' or 'data'
  String _limitUnit = 'hours'; // minutes, hours, days, MB, GB

  // Step 2: Validity
  int? _validitySeconds; // null = open
  bool _isCustomValidity = false;
  final _customValidityController = TextEditingController();
  String _customValidityUnit = 'hours'; // 'hours' or 'days'

  @override
  void dispose() {
    _pageController.dispose();
    _limitValueController.dispose();
    _countController.dispose();
    _priceController.dispose();
    _customValidityController.dispose();
    super.dispose();
  }

  void _goNext() {
    if (_currentStep == 0) {
      if (!_step1FormKey.currentState!.validate()) return;
    }
    FocusScope.of(context).unfocus();
    final next = _currentStep + 1;
    _pageController.animateToPage(next,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep = next);
  }

  void _goBack() {
    FocusScope.of(context).unfocus();
    final prev = _currentStep - 1;
    _pageController.animateToPage(prev,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep = prev);
  }

  Future<void> _submit() async {
    if (!_step3FormKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _isSubmitting = true);
    ref.read(vouchersProvider.notifier).clearError();

    final limitValue = int.parse(_limitValueController.text.trim());
    final count = int.parse(_countController.text.trim());
    final price = double.parse(_priceController.text.trim());

    final success = await ref.read(vouchersProvider.notifier).createVouchers(
          routerId: widget.routerId,
          limitType: _limitType,
          limitValue: limitValue,
          limitUnit: _limitUnit,
          validitySeconds: _validitySeconds,
          count: count,
          price: price,
        );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(count == 1
              ? 'Voucher created successfully'
              : '$count vouchers created successfully'),
          backgroundColor: AppColors.success,
        ),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(vouchersProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Create Voucher'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildProgressIndicator(),
            if (state.error != null)
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: _buildErrorBox(state.error!),
              ),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildStep1Limit(),
                  _buildStep2Validity(),
                  _buildStep3CountPrice(),
                ],
              ),
            ),
            _buildBottomBar(),
          ],
        ),
      ),
    );
  }

  // ---- Progress Indicator ----

  Widget _buildProgressIndicator() {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl, vertical: AppSpacing.lg),
      child: Row(
        children: List.generate(5, (index) {
          if (index.isEven) {
            final stepIndex = index ~/ 2;
            return _buildStepCircle(
              stepIndex: stepIndex,
              isCompleted: stepIndex < _currentStep,
              isActive: stepIndex == _currentStep,
            );
          } else {
            final leftStepIndex = index ~/ 2;
            return Expanded(
              child: Container(
                height: 2,
                color: leftStepIndex < _currentStep
                    ? AppColors.success
                    : AppColors.border,
              ),
            );
          }
        }),
      ),
    );
  }

  Widget _buildStepCircle({
    required int stepIndex,
    required bool isCompleted,
    required bool isActive,
  }) {
    Color bgColor;
    Widget child;

    if (isCompleted) {
      bgColor = AppColors.success;
      child = const Icon(Icons.check, size: 16, color: Colors.white);
    } else if (isActive) {
      bgColor = AppColors.primary;
      child = Text(
        '${stepIndex + 1}',
        style: const TextStyle(
            fontSize: 13, fontWeight: FontWeight.w600, color: Colors.white),
      );
    } else {
      bgColor = AppColors.border;
      child = Text(
        '${stepIndex + 1}',
        style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(shape: BoxShape.circle, color: bgColor),
          alignment: Alignment.center,
          child: child,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _stepLabels[stepIndex],
          style: AppTypography.caption2.copyWith(
            color: isActive || isCompleted
                ? AppColors.textPrimary
                : AppColors.textTertiary,
            fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ],
    );
  }

  // ---- Step 1: Limit Type ----

  Widget _buildStep1Limit() {
    return Form(
      key: _step1FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text('What type of limit?',
              style: AppTypography.headline
                  .copyWith(color: AppColors.textPrimary)),
          const SizedBox(height: AppSpacing.lg),

          // Time / Data toggle
          Row(
            children: [
              Expanded(
                child: _buildLimitTypeCard(
                  icon: Icons.access_time,
                  label: 'Time Limit',
                  value: 'time',
                  selected: _limitType == 'time',
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _buildLimitTypeCard(
                  icon: Icons.data_usage,
                  label: 'Data Limit',
                  value: 'data',
                  selected: _limitType == 'data',
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xl),

          // Value input + unit picker
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: _limitValueController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'Value',
                    hintText: 'e.g. 2',
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Required';
                    final n = int.tryParse(v.trim());
                    if (n == null || n <= 0) return 'Must be > 0';
                    return null;
                  },
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                flex: 2,
                child: DropdownButtonFormField<String>(
                  value: _limitUnit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: _limitType == 'time'
                      ? const [
                          DropdownMenuItem(
                              value: 'minutes', child: Text('Minutes')),
                          DropdownMenuItem(
                              value: 'hours', child: Text('Hours')),
                          DropdownMenuItem(
                              value: 'days', child: Text('Days')),
                        ]
                      : const [
                          DropdownMenuItem(value: 'MB', child: Text('MB')),
                          DropdownMenuItem(value: 'GB', child: Text('GB')),
                        ],
                  onChanged: (v) {
                    if (v != null) setState(() => _limitUnit = v);
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),

          // Hint text
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline,
                    size: 18, color: AppColors.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    _limitType == 'time'
                        ? 'Total online time allowed for this voucher.'
                        : 'Total data usage allowed for this voucher.',
                    style: AppTypography.subhead
                        .copyWith(color: AppColors.primary),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLimitTypeCard({
    required IconData icon,
    required String label,
    required String value,
    required bool selected,
  }) {
    return GestureDetector(
      onTap: () {
        setState(() {
          _limitType = value;
          // Reset unit when switching type
          _limitUnit = value == 'time' ? 'hours' : 'GB';
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(
            vertical: AppSpacing.lg, horizontal: AppSpacing.md),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.primary.withValues(alpha: 0.1)
              : AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.border,
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(icon,
                size: 32,
                color: selected ? AppColors.primary : AppColors.textSecondary),
            const SizedBox(height: AppSpacing.sm),
            Text(
              label,
              style: AppTypography.subhead.copyWith(
                color: selected ? AppColors.primary : AppColors.textSecondary,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---- Step 2: Validity ----

  Widget _buildStep2Validity() {
    final presets = <_ValidityPreset>[
      _ValidityPreset('Open', null),
      _ValidityPreset('1h', 3600),
      _ValidityPreset('6h', 21600),
      _ValidityPreset('12h', 43200),
      _ValidityPreset('1d', 86400),
      _ValidityPreset('3d', 259200),
      _ValidityPreset('7d', 604800),
      _ValidityPreset('30d', 2592000),
    ];

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text('Voucher validity',
            style: AppTypography.headline
                .copyWith(color: AppColors.textPrimary)),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'How long after first use should the voucher remain valid?',
          style:
              AppTypography.body.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.xl),

        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            ...presets.map((preset) {
              final isSelected =
                  !_isCustomValidity && _validitySeconds == preset.seconds;
              return ChoiceChip(
                label: Text(preset.label),
                selected: isSelected,
                onSelected: (_) {
                  setState(() {
                    _isCustomValidity = false;
                    _validitySeconds = preset.seconds;
                  });
                },
                selectedColor: AppColors.primary.withValues(alpha: 0.15),
                labelStyle: AppTypography.subhead.copyWith(
                  color:
                      isSelected ? AppColors.primary : AppColors.textPrimary,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                ),
                side: BorderSide(
                  color: isSelected ? AppColors.primary : AppColors.border,
                ),
              );
            }),
            ChoiceChip(
              label: const Text('Custom'),
              selected: _isCustomValidity,
              onSelected: (_) {
                setState(() {
                  _isCustomValidity = true;
                  _updateCustomValidity();
                });
              },
              selectedColor: AppColors.primary.withValues(alpha: 0.15),
              labelStyle: AppTypography.subhead.copyWith(
                color: _isCustomValidity
                    ? AppColors.primary
                    : AppColors.textPrimary,
                fontWeight:
                    _isCustomValidity ? FontWeight.w600 : FontWeight.w400,
              ),
              side: BorderSide(
                color: _isCustomValidity ? AppColors.primary : AppColors.border,
              ),
            ),
          ],
        ),

        if (_isCustomValidity) ...[
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _customValidityController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'Value',
                    hintText: 'e.g. 5',
                  ),
                  onChanged: (_) => _updateCustomValidity(),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                flex: 2,
                child: DropdownButtonFormField<String>(
                  value: _customValidityUnit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: const [
                    DropdownMenuItem(value: 'hours', child: Text('Hours')),
                    DropdownMenuItem(value: 'days', child: Text('Days')),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setState(() {
                        _customValidityUnit = v;
                        _updateCustomValidity();
                      });
                    }
                  },
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: AppSpacing.xl),

        // Explanation card
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    _validitySeconds == null
                        ? Icons.all_inclusive
                        : Icons.timer,
                    size: 18,
                    color: AppColors.textSecondary,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      _validitySeconds == null
                          ? 'Open Voucher'
                          : 'Validity: ${_formatDuration(_validitySeconds!)}',
                      style: AppTypography.subhead.copyWith(
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                _validitySeconds == null
                    ? 'The voucher has no time expiry. It will only expire when the ${_limitType == "time" ? "online time" : "data"} limit is used up.'
                    : 'The voucher will expire ${_formatDuration(_validitySeconds!)} after the first login, regardless of how much ${_limitType == "time" ? "time" : "data"} is left.',
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _updateCustomValidity() {
    final n = int.tryParse(_customValidityController.text.trim());
    if (n != null && n > 0) {
      setState(() {
        _validitySeconds =
            _customValidityUnit == 'days' ? n * 86400 : n * 3600;
      });
    }
  }

  String _formatDuration(int seconds) {
    if (seconds < 3600) return '${seconds ~/ 60} minutes';
    if (seconds < 86400) {
      final hours = seconds ~/ 3600;
      return '$hours ${hours == 1 ? "hour" : "hours"}';
    }
    final days = seconds ~/ 86400;
    return '$days ${days == 1 ? "day" : "days"}';
  }

  // ---- Step 3: Count & Price ----

  Widget _buildStep3CountPrice() {
    final limitText = _limitValueController.text.isNotEmpty
        ? '${_limitValueController.text} $_limitUnit'
        : '';
    final validityText = _validitySeconds == null
        ? 'Open (no expiry)'
        : _formatDuration(_validitySeconds!);

    final count = int.tryParse(_countController.text.trim()) ?? 0;
    final price = double.tryParse(_priceController.text.trim()) ?? 0;
    final totalPrice = count * price;

    return Form(
      key: _step3FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text('How many vouchers?',
              style: AppTypography.headline
                  .copyWith(color: AppColors.textPrimary)),
          const SizedBox(height: AppSpacing.lg),

          TextFormField(
            controller: _countController,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Number of vouchers',
              hintText: '1',
            ),
            onChanged: (_) => setState(() {}),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Required';
              final n = int.tryParse(v.trim());
              if (n == null || n < 1) return 'Must be at least 1';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),

          TextFormField(
            controller: _priceController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,2}')),
            ],
            decoration: const InputDecoration(
              labelText: 'Price per voucher',
              hintText: '0.00',
            ),
            onChanged: (_) => setState(() {}),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Required';
              final n = double.tryParse(v.trim());
              if (n == null || n < 0) return 'Invalid price';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.xl),

          // Summary card
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Summary',
                    style: AppTypography.subhead.copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary)),
                const SizedBox(height: AppSpacing.md),
                _buildSummaryRow(
                  'Limit',
                  '${_limitType == "time" ? "Time" : "Data"}: $limitText',
                ),
                const SizedBox(height: AppSpacing.sm),
                _buildSummaryRow('Validity', validityText),
                const SizedBox(height: AppSpacing.sm),
                _buildSummaryRow('Count', '$count'),
                const SizedBox(height: AppSpacing.sm),
                _buildSummaryRow(
                  'Price',
                  '${price.toStringAsFixed(2)} each',
                ),
                if (count > 1) ...[
                  const Divider(height: AppSpacing.lg),
                  _buildSummaryRow(
                    'Total',
                    totalPrice.toStringAsFixed(2),
                    bold: true,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value, {bool bold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: AppTypography.caption1
                .copyWith(color: AppColors.textSecondary)),
        Text(value,
            style: AppTypography.subhead.copyWith(
              color: AppColors.textPrimary,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
            )),
      ],
    );
  }

  // ---- Bottom Bar ----

  Widget _buildBottomBar() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Row(
          children: [
            if (_currentStep > 0) ...[
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    onPressed: _isSubmitting ? null : _goBack,
                    child: const Text('Back'),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
            ],
            Expanded(
              child: SizedBox(
                height: 48,
                child: _currentStep < 2
                    ? ElevatedButton(
                        onPressed: _goNext,
                        child: const Text('Next'),
                      )
                    : ElevatedButton(
                        onPressed: _isSubmitting ? null : _submit,
                        child: _isSubmitting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(
                                int.tryParse(_countController.text.trim()) == 1
                                    ? 'Create Voucher'
                                    : 'Create ${_countController.text.trim()} Vouchers',
                              ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorBox(String error) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Text(
        error,
        style: AppTypography.subhead.copyWith(color: AppColors.error),
      ),
    );
  }
}

class _ValidityPreset {
  final String label;
  final int? seconds;
  const _ValidityPreset(this.label, this.seconds);
}
