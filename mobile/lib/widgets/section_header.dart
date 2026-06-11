import 'package:flutter/material.dart';
import '../theme/theme.dart';

/// Section title with optional trailing action — standard vertical rhythm
/// between content sections.
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(
        top: AppSpacing.sm,
        bottom: AppSpacing.md,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(title, style: AppTypography.title3)),
          if (action != null) action!,
        ],
      ),
    );
  }
}
