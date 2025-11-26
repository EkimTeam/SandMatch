"""
Тесты для расчета коэффициента турнира.
"""
from django.test import TestCase
from apps.tournaments.services.coefficient_calculator import calculate_tournament_coefficient


class TournamentCoefficientTestCase(TestCase):
    """Тесты расчета коэффициента турнира по таблице"""

    def test_low_rating_small_tournament(self):
        """Низкий рейтинг, мало участников: 0.6"""
        coef = calculate_tournament_coefficient(avg_rating=750, participants_count=6, has_prize_fund=False)
        self.assertEqual(coef, 0.6)

    def test_low_rating_medium_tournament(self):
        """Низкий рейтинг, средний турнир: 0.8"""
        coef = calculate_tournament_coefficient(avg_rating=800, participants_count=14, has_prize_fund=False)
        self.assertEqual(coef, 0.8)

    def test_low_rating_large_tournament(self):
        """Низкий рейтинг, большой турнир: 1.0"""
        coef = calculate_tournament_coefficient(avg_rating=750, participants_count=30, has_prize_fund=False)
        self.assertEqual(coef, 1.0)

    def test_medium_rating_small_tournament(self):
        """Средний рейтинг (900), мало участников: 0.7"""
        coef = calculate_tournament_coefficient(avg_rating=900, participants_count=7, has_prize_fund=False)
        self.assertEqual(coef, 0.7)

    def test_medium_rating_medium_tournament(self):
        """Средний рейтинг (1000), средний турнир: 1.0"""
        coef = calculate_tournament_coefficient(avg_rating=1000, participants_count=14, has_prize_fund=False)
        self.assertEqual(coef, 1.0)

    def test_high_rating_small_tournament(self):
        """Высокий рейтинг (1100), мало участников: 0.9"""
        # 1100 попадает в строку 1051-1200, 8 участников - столбец <=8
        coef = calculate_tournament_coefficient(avg_rating=1100, participants_count=8, has_prize_fund=False)
        self.assertEqual(coef, 0.9)

    def test_high_rating_medium_tournament(self):
        """Высокий рейтинг (1100), средний турнир: 1.1"""
        # 1100 попадает в строку 1051-1200, 15 участников - столбец 12-16
        coef = calculate_tournament_coefficient(avg_rating=1100, participants_count=15, has_prize_fund=False)
        self.assertEqual(coef, 1.1)

    def test_high_rating_large_tournament(self):
        """Высокий рейтинг (1100), большой турнир: 1.3"""
        # 1100 попадает в строку 1051-1200, 28 участников - столбец >24
        coef = calculate_tournament_coefficient(avg_rating=1100, participants_count=28, has_prize_fund=False)
        self.assertEqual(coef, 1.3)

    def test_very_high_rating_small_tournament(self):
        """Очень высокий рейтинг (1250), мало участников: 1.0"""
        # 1250 попадает в строку >1200, 8 участников - столбец <=8
        coef = calculate_tournament_coefficient(avg_rating=1250, participants_count=8, has_prize_fund=False)
        self.assertEqual(coef, 1.0)

    def test_very_high_rating_large_tournament(self):
        """Очень высокий рейтинг (1300), большой турнир: 1.4"""
        coef = calculate_tournament_coefficient(avg_rating=1300, participants_count=30, has_prize_fund=False)
        self.assertEqual(coef, 1.4)

    def test_elite_rating_large_tournament(self):
        """Элитный рейтинг (>1200), большой турнир: 1.4"""
        coef = calculate_tournament_coefficient(avg_rating=1500, participants_count=25, has_prize_fund=False)
        self.assertEqual(coef, 1.4)

    def test_prize_fund_bonus(self):
        """Бонус за призовой фонд: +0.2"""
        # Без призового фонда
        coef_no_prize = calculate_tournament_coefficient(avg_rating=1000, participants_count=14, has_prize_fund=False)
        # С призовым фондом
        coef_with_prize = calculate_tournament_coefficient(avg_rating=1000, participants_count=14, has_prize_fund=True)
        
        self.assertEqual(coef_no_prize, 1.0)
        self.assertEqual(coef_with_prize, 1.2)
        self.assertAlmostEqual(coef_with_prize - coef_no_prize, 0.2, places=5)

    def test_boundary_rating_800(self):
        """Граница рейтинга 800"""
        # Ровно 800 - попадает в первую строку
        coef_800 = calculate_tournament_coefficient(avg_rating=800, participants_count=10, has_prize_fund=False)
        # 801 - попадает во вторую строку
        coef_801 = calculate_tournament_coefficient(avg_rating=801, participants_count=10, has_prize_fund=False)
        
        self.assertEqual(coef_800, 0.7)
        self.assertEqual(coef_801, 0.8)

    def test_boundary_rating_950(self):
        """Граница рейтинга 950"""
        coef_950 = calculate_tournament_coefficient(avg_rating=950, participants_count=10, has_prize_fund=False)
        coef_951 = calculate_tournament_coefficient(avg_rating=951, participants_count=10, has_prize_fund=False)
        
        self.assertEqual(coef_950, 0.8)
        self.assertEqual(coef_951, 0.9)

    def test_boundary_rating_1050(self):
        """Граница рейтинга 1050"""
        coef_1050 = calculate_tournament_coefficient(avg_rating=1050, participants_count=10, has_prize_fund=False)
        coef_1051 = calculate_tournament_coefficient(avg_rating=1051, participants_count=10, has_prize_fund=False)
        
        self.assertEqual(coef_1050, 0.9)
        self.assertEqual(coef_1051, 1.0)

    def test_boundary_rating_1200(self):
        """Граница рейтинга 1200"""
        coef_1200 = calculate_tournament_coefficient(avg_rating=1200, participants_count=10, has_prize_fund=False)
        coef_1201 = calculate_tournament_coefficient(avg_rating=1201, participants_count=10, has_prize_fund=False)
        
        self.assertEqual(coef_1200, 1.0)
        self.assertEqual(coef_1201, 1.1)

    def test_boundary_participants_8(self):
        """Граница участников 8"""
        coef_8 = calculate_tournament_coefficient(avg_rating=1000, participants_count=8, has_prize_fund=False)
        coef_9 = calculate_tournament_coefficient(avg_rating=1000, participants_count=9, has_prize_fund=False)
        
        self.assertEqual(coef_8, 0.8)
        self.assertEqual(coef_9, 0.9)

    def test_boundary_participants_12(self):
        """Граница участников 12"""
        coef_12 = calculate_tournament_coefficient(avg_rating=1000, participants_count=12, has_prize_fund=False)
        coef_13 = calculate_tournament_coefficient(avg_rating=1000, participants_count=13, has_prize_fund=False)
        
        self.assertEqual(coef_12, 0.9)
        self.assertEqual(coef_13, 1.0)

    def test_boundary_participants_16(self):
        """Граница участников 16"""
        coef_16 = calculate_tournament_coefficient(avg_rating=1000, participants_count=16, has_prize_fund=False)
        coef_17 = calculate_tournament_coefficient(avg_rating=1000, participants_count=17, has_prize_fund=False)
        
        self.assertEqual(coef_16, 1.0)
        self.assertEqual(coef_17, 1.1)

    def test_boundary_participants_24(self):
        """Граница участников 24"""
        coef_24 = calculate_tournament_coefficient(avg_rating=1000, participants_count=24, has_prize_fund=False)
        coef_25 = calculate_tournament_coefficient(avg_rating=1000, participants_count=25, has_prize_fund=False)
        
        self.assertEqual(coef_24, 1.1)
        self.assertEqual(coef_25, 1.2)

    def test_extreme_values(self):
        """Экстремальные значения"""
        # Очень низкий рейтинг, 1 участник
        coef_min = calculate_tournament_coefficient(avg_rating=100, participants_count=1, has_prize_fund=False)
        self.assertEqual(coef_min, 0.6)
        
        # Очень высокий рейтинг, много участников, с призовым фондом
        coef_max = calculate_tournament_coefficient(avg_rating=2000, participants_count=100, has_prize_fund=True)
        self.assertAlmostEqual(coef_max, 1.6, places=5)  # 1.4 + 0.2

    def test_realistic_scenarios(self):
        """Реалистичные сценарии"""
        # Небольшой любительский турнир (850 = строка 801-950, 10 участников = столбец 9-12)
        coef1 = calculate_tournament_coefficient(avg_rating=850, participants_count=10, has_prize_fund=False)
        self.assertEqual(coef1, 0.8)
        
        # Средний городской турнир (1050 = строка 951-1050, 18 участников = столбец 17-24)
        coef2 = calculate_tournament_coefficient(avg_rating=1050, participants_count=18, has_prize_fund=False)
        self.assertEqual(coef2, 1.1)
        
        # Крупный региональный турнир с призами (1150 = строка 1051-1200, 32 участников = столбец >24)
        coef3 = calculate_tournament_coefficient(avg_rating=1150, participants_count=32, has_prize_fund=True)
        self.assertAlmostEqual(coef3, 1.5, places=5)  # 1.3 + 0.2
        
        # Элитный всероссийский турнир с призами (1400 = строка >1200, 40 участников = столбец >24)
        coef4 = calculate_tournament_coefficient(avg_rating=1400, participants_count=40, has_prize_fund=True)
        self.assertAlmostEqual(coef4, 1.6, places=5)  # 1.4 + 0.2
