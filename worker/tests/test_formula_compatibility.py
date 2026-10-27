import pytest
from worker.formula_compatibility import FormulaCompatibilityError, inline_let, inline_nested_let


def test_let_expansion_preserves_scope_precedence_and_literals():
    value, count = inline_let('=LET(rate,2,LET(rate,rate+1,rate*4))+LET(rate,5,rate)')
    assert count == 3
    assert eval(value[1:]) == 17
    value, count = inline_let('=LET(rate,2,rate+"rate"+\'rate\'!A1+$A$1+rateExtra)')
    assert '"rate"' in value and "'rate'!A1" in value and '$A$1' in value and 'rateExtra' in value
    assert '(2)' in value and count == 1


def test_excel_namespace_and_array_arguments():
    value, count = inline_let('=IFERROR(_xlfn.LET(_xlpm.values,{1,2,3},SUM(_xlpm.values)),0)')
    assert value == '=IFERROR((SUM(({1,2,3}))),0)'
    assert count == 1
    assert inline_let('=SUM(A1:A4)') == ('=SUM(A1:A4)', 0)


@pytest.mark.parametrize('formula', ['=LET(x,NOW(),x+x)', '=LET(x,RAND(),x)', '=LET(x,1,x,2,x)', '=LET(A1,1,A1)', '=LET(x,1)', '=LET(x,1,x(2))'])
def test_unsupported_bindings_are_not_silently_changed(formula):
    with pytest.raises(FormulaCompatibilityError):
        inline_let(formula)


def test_expansion_is_bounded():
    with pytest.raises(FormulaCompatibilityError):
        inline_let('=LET(x,"' + 'a'*4000 + '",x&x&x)')


def test_only_nested_bindings_are_rewritten_for_runtime_compatibility():
    source = '=LET(rate,RAND(),rate+2)'
    assert inline_nested_let(source) == (source, 0)
    result, count = inline_nested_let('=LET(rate,2,LET(cost,rate+1,cost*4))')
    assert result == '=LET(rate,2,((rate+1)*4))'
    assert count == 1
    assert inline_nested_let('=_XLFN.LET(_XLPM.rate,2,_XLFN.LET(_XLPM.cost,_xlpm.rate+1,_XLPM.cost*4))') == ('=_XLFN.LET(_XLPM.rate,2,((_xlpm.rate+1)*4))', 1)
