import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/payment_record.dart';

void main() {
  final validJson = {
    'id': 'pay-1',
    'planTier': 'starter',
    'planName': 'Starter',
    'amount': 500,
    'currency': 'SDG',
    'referenceCode': 'REF-001',
    'receiptUrl': null,
    'status': 'pending',
    'rejectionReason': null,
    'reviewedAt': null,
    'createdAt': '2026-07-01T10:00:00.000Z',
  };

  group('PaymentRecord', () {
    test('fromJson creates correct object', () {
      final payment = PaymentRecord.fromJson(validJson);
      expect(payment.id, 'pay-1');
      expect(payment.planTier, 'starter');
      expect(payment.planName, 'Starter');
      expect(payment.amount, 500.0);
      expect(payment.currency, 'SDG');
      expect(payment.status, 'pending');
      expect(payment.isPending, isTrue);
    });

    test('fromJson falls back to planTier when planName absent', () {
      final json = {...validJson}..remove('planName');
      final payment = PaymentRecord.fromJson(json);
      expect(payment.planName, 'starter');
    });

    // ── planNameAr localization field ─────────────────────────────────────────

    test('fromJson parses planNameAr when present', () {
      final payment =
          PaymentRecord.fromJson({...validJson, 'planNameAr': 'ستارتر'});
      expect(payment.planNameAr, 'ستارتر');
    });

    test('fromJson sets planNameAr to null when absent', () {
      final payment = PaymentRecord.fromJson(validJson);
      expect(payment.planNameAr, isNull);
    });

    test('fromJson sets planNameAr to null when explicitly null in JSON', () {
      final payment =
          PaymentRecord.fromJson({...validJson, 'planNameAr': null});
      expect(payment.planNameAr, isNull);
    });

    // ── Status helpers ────────────────────────────────────────────────────────

    test('isApproved true for approved status', () {
      expect(
        PaymentRecord.fromJson({...validJson, 'status': 'approved'}).isApproved,
        isTrue,
      );
    });

    test('isRejected true for rejected status', () {
      expect(
        PaymentRecord.fromJson({...validJson, 'status': 'rejected'}).isRejected,
        isTrue,
      );
    });

    test('isCancelled true for cancelled status', () {
      expect(
        PaymentRecord.fromJson({...validJson, 'status': 'cancelled'})
            .isCancelled,
        isTrue,
      );
    });

    test('hasReceipt false when receiptUrl is null', () {
      expect(PaymentRecord.fromJson(validJson).hasReceipt, isFalse);
    });

    test('hasReceipt true when receiptUrl is non-empty', () {
      expect(
        PaymentRecord.fromJson(
                {...validJson, 'receiptUrl': 'https://example.com/receipt.jpg'})
            .hasReceipt,
        isTrue,
      );
    });
  });
}
