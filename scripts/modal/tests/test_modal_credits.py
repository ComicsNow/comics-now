from decimal import Decimal
import os
import pytest
from unittest.mock import MagicMock, patch

def calculate_modal_credits(summary, monthly_budget=30.0):
    credits_used = float(abs(summary.adjustments.get("Credits", 0)))
    total_credits = max(monthly_budget, round(credits_used, 2))
    available_credits = max(0.0, total_credits - credits_used)
    billed_cost = float(summary.billed_cost)
    
    free_adjustments = sum(
        float(abs(v)) for k, v in summary.adjustments.items()
        if k != "Credits" and float(v) < 0
    )
    net_metered_cost = max(0.0, float(summary.metered_cost) - free_adjustments)
    spend_limit_exceeded = (available_credits <= 0.0) or (billed_cost > 0.0)

    return {
        "ok": True,
        "totalCredits": round(total_credits, 2),
        "meteredCost": round(net_metered_cost, 2),
        "billedCost": round(billed_cost, 2),
        "availableCredits": round(available_credits, 2),
        "spendLimitExceeded": spend_limit_exceeded,
        "currency": "USD"
    }

def test_modal_credits_under_budget():
    summary = MagicMock()
    summary.metered_cost = Decimal("16.76")
    summary.billed_cost = Decimal("0.00")
    summary.adjustments = {
        "Free Storage": Decimal("-1.88"),
        "Network Egress Allowance": Decimal("-0.20"),
        "Credits": Decimal("-14.68")
    }

    res = calculate_modal_credits(summary, monthly_budget=30.0)
    assert res["totalCredits"] == 30.0
    assert res["meteredCost"] == 14.68
    assert res["billedCost"] == 0.0
    assert res["availableCredits"] == 15.32
    assert res["spendLimitExceeded"] is False

def test_modal_credits_exceeded():
    summary = MagicMock()
    summary.metered_cost = Decimal("35.00")
    summary.billed_cost = Decimal("5.00")
    summary.adjustments = {
        "Credits": Decimal("-30.00")
    }

    res = calculate_modal_credits(summary, monthly_budget=30.0)
    assert res["totalCredits"] == 30.0
    assert res["meteredCost"] == 35.0
    assert res["billedCost"] == 5.0
    assert res["availableCredits"] == 0.0
    assert res["spendLimitExceeded"] is True
