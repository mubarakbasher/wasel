import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/routers_provider.dart';
import '../../services/router_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class AddRouterScreen extends ConsumerStatefulWidget {
  const AddRouterScreen({super.key});

  @override
  ConsumerState<AddRouterScreen> createState() => _AddRouterScreenState();
}

class _AddRouterScreenState extends ConsumerState<AddRouterScreen> {
  static const _stepLabels = ['Router Info', 'Details', 'Setup Guide'];

  final _pageController = PageController();
  final _step1FormKey = GlobalKey<FormState>();
  final _step2FormKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _modelController = TextEditingController();
  final _rosVersionController = TextEditingController();
  final _apiUserController = TextEditingController();
  final _apiPassController = TextEditingController();

  int _currentStep = 0;
  bool _obscurePassword = true;
  bool _isSubmitting = false;
  String? _createdRouterId;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(routersProvider.notifier).clearError());
  }

  @override
  void dispose() {
    _pageController.dispose();
    _nameController.dispose();
    _modelController.dispose();
    _rosVersionController.dispose();
    _apiUserController.dispose();
    _apiPassController.dispose();
    super.dispose();
  }

  void _goNext() {
    if (!_step1FormKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    _pageController.animateToPage(1,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep = 1);
  }

  void _goBack() {
    FocusScope.of(context).unfocus();
    _pageController.animateToPage(_currentStep - 1,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep--);
  }

  Future<void> _submitAndLoadGuide() async {
    if (!_step2FormKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _isSubmitting = true);
    ref.read(routersProvider.notifier).clearError();

    final success = await ref.read(routersProvider.notifier).createRouter(
          name: _nameController.text.trim(),
          model: _modelController.text.trim().isEmpty
              ? null
              : _modelController.text.trim(),
          rosVersion: _rosVersionController.text.trim().isEmpty
              ? null
              : _rosVersionController.text.trim(),
          apiUser: _apiUserController.text.trim().isEmpty
              ? null
              : _apiUserController.text.trim(),
          apiPass:
              _apiPassController.text.isEmpty ? null : _apiPassController.text,
        );

    if (!mounted) return;

    if (success) {
      final router = ref.read(routersProvider).selectedRouter;
      if (router != null) {
        _createdRouterId = router.id;
        await ref.read(routersProvider.notifier).loadSetupGuide(router.id);
      }
      if (mounted) {
        _pageController.animateToPage(2,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeInOut);
        setState(() {
          _currentStep = 2;
          _isSubmitting = false;
        });
      }
    } else {
      setState(() => _isSubmitting = false);
    }
  }

  void _finish() {
    if (_createdRouterId != null) {
      context.pushReplacement('/routers/detail', extra: _createdRouterId);
    } else {
      context.pop();
    }
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Setup guide copied to clipboard')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    return PopScope(
      canPop: _currentStep == 0 || _currentStep == 2,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _currentStep == 1) _goBack();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Add Router'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (_currentStep == 1) {
                _goBack();
              } else {
                context.pop();
              }
            },
          ),
        ),
        body: Column(
          children: [
            _buildProgressIndicator(),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildStep1RouterInfo(state),
                  _buildStep2RouterDetails(state),
                  _buildStep3SetupGuide(state),
                ],
              ),
            ),
            _buildBottomBar(state),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressIndicator() {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl, vertical: AppSpacing.lg),
      child: Row(
        children: List.generate(5, (index) {
          // 0, 2, 4 = circles; 1, 3 = connectors
          if (index.isEven) {
            final stepIndex = index ~/ 2;
            final isCompleted = stepIndex < _currentStep;
            final isActive = stepIndex == _currentStep;
            return _buildStepCircle(
              stepIndex: stepIndex,
              isCompleted: isCompleted,
              isActive: isActive,
            );
          } else {
            final leftStepIndex = index ~/ 2;
            final isCompleted = leftStepIndex < _currentStep;
            return Expanded(
              child: Container(
                height: 2,
                color: isCompleted ? AppColors.success : AppColors.border,
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
            fontWeight:
                isActive ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ],
    );
  }

  Widget _buildStep1RouterInfo(RoutersState state) {
    return Form(
      key: _step1FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text('Basic Information', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Give your router a name to identify it.',
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxl),
          if (state.error != null && _currentStep == 0) ...[
            _buildErrorBox(state.error!),
            const SizedBox(height: AppSpacing.lg),
          ],
          TextFormField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Router Name *',
              prefixIcon: Icon(Icons.router),
              hintText: 'e.g. Cafe Main Router',
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return 'Router name is required';
              }
              if (value.trim().length < 2) {
                return 'Name must be at least 2 characters';
              }
              if (value.trim().length > 100) {
                return 'Name must be at most 100 characters';
              }
              return null;
            },
            onChanged: (_) => ref.read(routersProvider.notifier).clearError(),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _modelController,
            decoration: const InputDecoration(
              labelText: 'Model',
              prefixIcon: Icon(Icons.devices),
              hintText: 'e.g. hAP ac2',
            ),
            validator: (value) {
              if (value != null && value.length > 100) {
                return 'Model must be at most 100 characters';
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStep2RouterDetails(RoutersState state) {
    return Form(
      key: _step2FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text('Technical Details', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Optional RouterOS API credentials for remote management.',
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxl),
          if (state.error != null && _currentStep == 1) ...[
            _buildErrorBox(state.error!),
            const SizedBox(height: AppSpacing.lg),
          ],
          TextFormField(
            controller: _rosVersionController,
            decoration: const InputDecoration(
              labelText: 'RouterOS Version',
              prefixIcon: Icon(Icons.system_update),
              hintText: 'e.g. 7.14',
            ),
            validator: (value) {
              if (value != null && value.length > 20) {
                return 'Version must be at most 20 characters';
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _apiUserController,
            decoration: const InputDecoration(
              labelText: 'API Username',
              prefixIcon: Icon(Icons.person),
              hintText: 'e.g. admin',
            ),
            validator: (value) {
              if (value != null && value.length > 100) {
                return 'Username must be at most 100 characters';
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _apiPassController,
            obscureText: _obscurePassword,
            decoration: InputDecoration(
              labelText: 'API Password',
              prefixIcon: const Icon(Icons.lock),
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_off : Icons.visibility,
                ),
                onPressed: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
            validator: (value) {
              if (value != null && value.length > 255) {
                return 'Password must be at most 255 characters';
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStep3SetupGuide(RoutersState state) {
    final guide = state.setupGuide;

    if (_isSubmitting || (state.isLoading && guide == null)) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && guide == null && _currentStep == 2) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 64, color: AppColors.error),
              const SizedBox(height: AppSpacing.lg),
              Text(state.error!,
                  style: AppTypography.body, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.xxl),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: () {
                    if (_createdRouterId != null) {
                      ref
                          .read(routersProvider.notifier)
                          .loadSetupGuide(_createdRouterId!);
                    }
                  },
                  child: const Text('Retry'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (guide == null) {
      return Center(
        child: Text('Setup guide not available',
            style: AppTypography.body
                .copyWith(color: AppColors.textSecondary)),
      );
    }

    return _buildGuideContent(guide);
  }

  Widget _buildGuideContent(RouterSetupGuide guide) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(guide.routerName, style: AppTypography.title2),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Follow these steps to connect your Mikrotik router to Wasel.',
          style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.lg),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            if (guide.tunnelIp != null)
              Chip(
                avatar:
                    Icon(Icons.lan, size: 16, color: AppColors.textSecondary),
                label: Text(guide.tunnelIp!, style: AppTypography.caption1),
                backgroundColor: AppColors.background,
                side: BorderSide(color: AppColors.border),
              ),
            Chip(
              avatar:
                  Icon(Icons.dns, size: 16, color: AppColors.textSecondary),
              label:
                  Text(guide.serverEndpoint, style: AppTypography.caption1),
              backgroundColor: AppColors.background,
              side: BorderSide(color: AppColors.border),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xxl),
        if (guide.steps.isNotEmpty)
          ...guide.steps.map((step) => _buildStepCard(step))
        else
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(color: AppColors.border),
            ),
            child: SelectableText(
              guide.setupGuide,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                height: 1.5,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        const SizedBox(height: AppSpacing.xxl),
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _copyToClipboard(guide.setupGuide),
            icon: const Icon(Icons.copy),
            label: const Text('Copy All to Clipboard'),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  Widget _buildStepCard(SetupStep step) {
    final isVerification = step.step >= 9;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: isVerification ? AppColors.success.withValues(alpha: 0.4) : AppColors.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.md, 0),
              child: Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isVerification
                          ? AppColors.success
                          : AppColors.primary,
                    ),
                    alignment: Alignment.center,
                    child: isVerification
                        ? const Icon(Icons.check, size: 16, color: Colors.white)
                        : Text(
                            '${step.step}',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      step.title,
                      style: AppTypography.headline.copyWith(fontSize: 15),
                    ),
                  ),
                ],
              ),
            ),
            // Description
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.xs, AppSpacing.lg, AppSpacing.sm),
              child: Text(
                step.description,
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
            // Command box
            Container(
              margin: const EdgeInsets.fromLTRB(
                  AppSpacing.sm, 0, AppSpacing.sm, AppSpacing.sm),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E1E),
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: SelectableText(
                      step.command,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        height: 1.5,
                        color: Color(0xFFD4D4D4),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  InkWell(
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: step.command));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Step ${step.step} copied'),
                          duration: const Duration(seconds: 1),
                        ),
                      );
                    },
                    child: const Icon(
                      Icons.copy,
                      size: 18,
                      color: Color(0xFF9E9E9E),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomBar(RoutersState state) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Row(
          children: [
            if (_currentStep == 1) ...[
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
            if (_currentStep == 0)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _goNext,
                    child: const Text('Next'),
                  ),
                ),
              ),
            if (_currentStep == 1)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _submitAndLoadGuide,
                    child: _isSubmitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Create Router'),
                  ),
                ),
              ),
            if (_currentStep == 2)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _finish,
                    child: const Text('Done'),
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
