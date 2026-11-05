"""核对官方到期字段，拒绝月份推断及异常报表。"""
import json
import unittest
from unittest.mock import patch, MagicMock
from contract_expiry import parse_contract_expiries, contract_expiries, basis_contract_expiries, SOURCE


class ContractExpiryTests(unittest.TestCase):
    def test_basis_historical_end_is_last_valid_csv_price(self):
        quotes = {("au2610", "2026-10"): {"2026-10-14": (100,), "2026-10-15": (None,)}}
        info = basis_contract_expiries(quotes, "2026-11-04", {})["au2610"]
        self.assertEqual(info["expiry_date"], "2026-10-14")
        self.assertEqual(info["expiry_basis"], "CSV最后有效报价日")

    def test_basis_live_estimate_and_confirmed_holiday_override(self):
        quotes = {("au2612", "2026-12"): {"2026-11-03": (100,)},
                  ("au2708", "2027-08"): {"2026-11-04": (101,)},
                  ("au2602", "2026-02"): {"2026-01-20": (102,)}}
        info = basis_contract_expiries(quotes, "2026-01-20", {"au2602": {"expiry_date": "2026-02-24"}})
        self.assertEqual(info["au2612"]["expiry_date"], "2026-12-15")
        self.assertTrue(info["au2612"]["expiry_estimated"])
        self.assertEqual(info["au2708"]["expiry_date"], "2027-08-16")
        self.assertEqual(info["au2602"]["expiry_date"], "2026-02-24")
        self.assertFalse(info["au2602"]["expiry_estimated"])
        self.assertNotEqual(basis_contract_expiries(quotes, "2026-11-04", {})["au2612"]["expiry_basis"],
                            "CSV最后有效报价日", "缺最新报价不能将远月合约判为到期")

    def test_official_date_retains_holiday_adjustment(self):
        rows = [{"INSTRUMENTID": "au2602 ", "TRADINGDAY": "20260202", "EXPIREDATE": "20260224"},
                {"INSTRUMENTID": "au2608", "TRADINGDAY": "20260202", "EXPIREDATE": "20260817"}]
        self.assertEqual(parse_contract_expiries({"ContractBaseInfo": rows}, "2026-02-02"),
                         {"au2602": "2026-02-24", "au2608": "2026-08-17"})

    def test_duplicate_or_invalid_dates_do_not_select_a_value(self):
        def row(code, expiry, trading="20261103"):
            return {"INSTRUMENTID": code, "TRADINGDAY": trading, "EXPIREDATE": expiry}
        payload = {"ContractBaseInfo": [row("au2612", "20261215"), row("au2612", "20261216"),
                                       row("au2702", "20270230"), row("au2704", "20270515"),
                                       row("au2706", "20270615", "20261102"), row("ag2612", "20261215")]}
        self.assertEqual(parse_contract_expiries(payload, "2026-11-03"), {"au2612": None})
        self.assertEqual(parse_contract_expiries([], "2026-11-03"), {})

    @patch("contract_expiry.urlopen")
    def test_network_values_and_traceable_fallback(self, request):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({"ContractBaseInfo": [
            {"INSTRUMENTID": "au2612", "TRADINGDAY": "20261103", "EXPIREDATE": "20261216"},
        ]}).encode()
        request.return_value = response
        result = contract_expiries("2026-11-03")["au2612"]
        self.assertEqual(result["expiry_date"], "2026-12-16", '当前官方数据优先于留存核对日期')
        self.assertEqual(result["expiry_source"], SOURCE.format(day="20261103"))
        request.side_effect = OSError("offline")
        self.assertEqual(contract_expiries("2026-11-03")["au2612"]["expiry_date"], "2026-12-15")
        self.assertNotIn("au2712", contract_expiries("2026-11-03"), '未核实的合约不按月份猜测')
