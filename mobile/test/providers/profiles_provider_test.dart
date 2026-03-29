import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/radius_profile.dart';
import 'package:wasel/providers/profiles_provider.dart';
import 'package:wasel/services/profile_service.dart';

class MockProfileService extends Mock implements ProfileService {}

void main() {
  late MockProfileService mockService;
  late ProfilesNotifier notifier;

  final mockProfile = RadiusProfile.fromJson({
    'id': 'p-1',
    'userId': 'u-1',
    'groupName': 'basic-plan',
    'displayName': 'Basic Plan',
    'bandwidthUp': '2M',
    'bandwidthDown': '5M',
    'sessionTimeout': 3600,
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  final mockProfile2 = RadiusProfile.fromJson({
    'id': 'p-2',
    'userId': 'u-1',
    'groupName': 'premium-plan',
    'displayName': 'Premium Plan',
    'bandwidthUp': '10M',
    'bandwidthDown': '20M',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  setUp(() {
    mockService = MockProfileService();
    notifier = ProfilesNotifier(profileService: mockService);
  });

  group('ProfilesNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.profiles, isEmpty);
      expect(notifier.state.selectedProfile, isNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadProfiles sets profiles on success', () async {
      when(() => mockService.getProfiles())
          .thenAnswer((_) async => [mockProfile, mockProfile2]);

      await notifier.loadProfiles();

      expect(notifier.state.profiles, hasLength(2));
      expect(notifier.state.profiles[0].displayName, 'Basic Plan');
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadProfiles sets error on failure', () async {
      when(() => mockService.getProfiles()).thenThrow(Exception('fail'));

      await notifier.loadProfiles();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('createProfile adds to list and returns true', () async {
      when(() => mockService.createProfile(
            groupName: 'basic-plan',
            displayName: 'Basic Plan',
          )).thenAnswer((_) async => mockProfile);

      final result = await notifier.createProfile(
        groupName: 'basic-plan',
        displayName: 'Basic Plan',
      );

      expect(result, true);
      expect(notifier.state.profiles, hasLength(1));
      expect(notifier.state.selectedProfile?.id, 'p-1');
    });

    test('createProfile returns false on failure', () async {
      when(() => mockService.createProfile(
            groupName: 'basic-plan',
            displayName: 'Basic Plan',
          )).thenThrow(Exception('duplicate'));

      final result = await notifier.createProfile(
        groupName: 'basic-plan',
        displayName: 'Basic Plan',
      );

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('deleteProfile removes from list', () async {
      when(() => mockService.getProfiles())
          .thenAnswer((_) async => [mockProfile, mockProfile2]);
      await notifier.loadProfiles();

      when(() => mockService.deleteProfile('p-1'))
          .thenAnswer((_) async {});

      final result = await notifier.deleteProfile('p-1');

      expect(result, true);
      expect(notifier.state.profiles, hasLength(1));
      expect(notifier.state.profiles[0].id, 'p-2');
    });

    test('deleteProfile returns false on failure', () async {
      when(() => mockService.deleteProfile('p-1'))
          .thenThrow(Exception('in use'));

      final result = await notifier.deleteProfile('p-1');

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadProfile sets selectedProfile', () async {
      when(() => mockService.getProfile('p-1'))
          .thenAnswer((_) async => mockProfile);

      await notifier.loadProfile('p-1');

      expect(notifier.state.selectedProfile?.id, 'p-1');
      expect(notifier.state.isLoading, false);
    });

    test('clearSelection clears selected profile', () async {
      when(() => mockService.getProfile('p-1'))
          .thenAnswer((_) async => mockProfile);
      await notifier.loadProfile('p-1');

      notifier.clearSelection();
      expect(notifier.state.selectedProfile, isNull);
    });

    test('updateProfile updates in list', () async {
      when(() => mockService.getProfiles())
          .thenAnswer((_) async => [mockProfile]);
      await notifier.loadProfiles();

      final updatedProfile = RadiusProfile.fromJson({
        'id': 'p-1',
        'userId': 'u-1',
        'groupName': 'basic-plan',
        'displayName': 'Updated Plan',
        'bandwidthUp': '5M',
        'bandwidthDown': '10M',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-02T00:00:00.000Z',
      });
      when(() => mockService.updateProfile('p-1', displayName: 'Updated Plan'))
          .thenAnswer((_) async => updatedProfile);

      final result = await notifier.updateProfile('p-1', displayName: 'Updated Plan');

      expect(result, true);
      expect(notifier.state.profiles[0].displayName, 'Updated Plan');
      expect(notifier.state.selectedProfile?.displayName, 'Updated Plan');
    });
  });
}
