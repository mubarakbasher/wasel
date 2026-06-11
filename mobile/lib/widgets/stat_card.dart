import 'package:flutter/material.dart';
import '../theme/theme.dart';
import 'app_card.dart';

/// Dashboard/reports metric tile — tinted icon chip, prominent value, label.
/// The value is wrapped in a FittedBox so long numbers (and Cairo's wider
/// digits) scale down instead of overflowing.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.color = AppColors.primary,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData? icon;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Container(
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(value, style: AppTypography.title1),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: AppTypography.footnote,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
